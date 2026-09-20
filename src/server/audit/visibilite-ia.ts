import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { availableCredits, spendCredits } from '@/server/billing/credits'
import { releaseReservation, reserveCredits } from '@/server/billing/reservation'
import { actionCosts, type ActionCost } from '@/server/billing/action-costs'
import {
  demander,
  plateformesDisponibles,
  type Plateforme,
} from '@/server/integrations/providers/assistants'
import { suggestQuestions } from '@/server/ai/operations'
import { lireVitrinePourArticle } from '@/server/commerce/boutique'
import { recherchesPourArticle } from './recherches'

/**
 * La visibilité dans les assistants, mesurée.
 *
 * Evoliia répète depuis le début qu'un bon score GEO ne garantit aucune apparition dans un
 * assistant. C'est vrai, et c'était un aveu d'impuissance : le produit disait ce qu'il ne
 * pouvait pas savoir sans jamais aller le chercher. On pose donc la question à l'assistant,
 * comme le ferait un client, et on lit la réponse.
 *
 * Cinq règles, et la première décide de tout le reste.
 *
 * **Une fréquence, jamais un oui ou un non.** Ces réponses ne sont pas déterministes : la
 * même question posée deux fois donne deux réponses. Un relevé isolé ne prouve rien, ni
 * dans un sens ni dans l'autre. C'est pourquoi chaque question est posée plusieurs fois par
 * passage, et pourquoi l'écran rend « vue dans 3 relevés sur 10 » — un chiffre qu'on peut
 * regarder bouger, pas un verdict.
 *
 * **La mention est constatée, pas jugée.** On cherche le nom de la marque dans le texte de
 * la réponse. Demander à un modèle « cette marque est-elle citée ? » rajouterait un appel,
 * un coût, et une occasion de se tromper sur une question à laquelle une recherche de
 * chaîne répond exactement.
 *
 * **Le sentiment n'est demandé que si la marque est citée.** Classer le ton d'une réponse
 * qui ne parle pas de vous n'a aucun sens, et le facturer serait indéfendable.
 *
 * **Le coût est réservé avant d'être engagé.** Chaque relevé est un appel payant à une
 * plateforme extérieure. Le tarif vient du catalogue administrable, jamais du code : un
 * exploitant qui ajuste son prix ne doit pas attendre un déploiement.
 *
 * **On ne mesure que ce qu'on interroge vraiment.** Voir `assistants.ts` : ni ChatGPT, ni
 * les encadrés IA de Google, parce qu'aucun des deux n'expose ce que voit son utilisateur.
 */

/** L'action facturée, telle qu'elle apparaît dans le catalogue de l'exploitant. */
export const ACTION_RELEVE = 'visibilite-ia'

/** Le tarif de repli, employé seulement si le catalogue ne dit rien. */
const COUT_PAR_DEFAUT = 3

/**
 * Combien de fois la même question est posée à une même plateforme, par passage.
 *
 * Deux, et c'est un compromis assumé. Une seule fois ne dirait rien d'une réponse non
 * déterministe ; cinq fois multiplierait la facture par deux et demi pour une précision que
 * personne ne lit. L'accumulation dans le temps fait le reste : dix passages de deux
 * relevés donnent vingt mesures, ce qui suffit largement à voir une tendance.
 */
export const REPETITIONS = 2

/** Au-delà, ce n'est plus un suivi mais une facture. */
export const PROMPTS_MAX = 40

export type PromptSuivi = {
  id: string
  texte: string
  theme: string
  actif: boolean
}

/** Ce qu'on sait d'une question, une fois les relevés comptés. */
export type Fréquence = {
  prompt: PromptSuivi
  /** Relevés retenus pour ce compte. */
  releves: number
  /** Ceux où la marque apparaît. */
  mentions: number
  /** bon | neutre | reserve | inconnu, le plus fréquent parmi les mentions. */
  sentiment: string
  /** Les adresses les plus souvent citées par les assistants, la marque ou non. */
  sources: string[]
}

/**
 * Les noms sous lesquels la marque peut apparaître.
 *
 * Un assistant écrit « Cap-Nature », « Cap Nature » ou « cap-nature.ch » selon son humeur.
 * Chercher une seule forme raterait les deux autres et annoncerait une absence qui n'en est
 * pas — l'erreur la plus coûteuse ici, parce qu'elle envoie corriger ce qui marche.
 */
export function formesDuNom(host: string, label: string): string[] {
  const formes = new Set<string>()
  const domaine = host.replace(/^www\./u, '')
  formes.add(domaine)

  const racine = domaine.split('.')[0] ?? ''
  if (racine.length >= 4) {
    formes.add(racine)
    formes.add(racine.replace(/-/gu, ' '))
  }

  const propre = label.trim()
  if (propre.length >= 4 && !propre.includes('.')) formes.add(propre)

  return [...formes].map((forme) => forme.toLowerCase()).filter((forme) => forme.length >= 4)
}

/** Le texte sans ses accents ni sa ponctuation, pour comparer ce qui s'écrit de trois façons. */
function aplatir(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
}

/**
 * La marque apparaît-elle, et où.
 *
 * Rend le passage plutôt qu'un simple oui : c'est ce qui permet à la personne de vérifier
 * elle-même, et de voir dans quel contexte elle est citée. Un « oui » sans le texte
 * demanderait de nous croire sur parole.
 */
export function chercherMention(
  reponse: string,
  formes: readonly string[],
): { mentionne: boolean; extrait: string } {
  const plat = aplatir(reponse)
  for (const forme of formes) {
    const cible = aplatir(forme).trim()
    if (cible === '') continue
    const position = plat.indexOf(cible)
    if (position < 0) continue

    /*
     * L'extrait est découpé dans le texte d'origine, pas dans la version aplatie : on rend
     * ce que l'assistant a écrit, accents et majuscules compris. Les deux chaînes n'ont pas
     * la même longueur, d'où une recherche approximative de la phrase qui contient le nom.
     */
    const phrases = reponse.split(/(?<=[.!?])\s+/u)
    const trouvee = phrases.find((phrase) => aplatir(phrase).includes(cible))
    return { mentionne: true, extrait: (trouvee ?? reponse).slice(0, 400).trim() }
  }
  return { mentionne: false, extrait: '' }
}

/**
 * Le ton de la mention, lu sur le passage.
 *
 * Volontairement sommaire et sans appel à un modèle : trois listes de mots et un défaut
 * neutre. Un classement fin demanderait un appel de plus par relevé — soit une facture
 * doublée pour une nuance que personne ne relit. Ce qu'on veut savoir tient en une
 * question : suis-je cité en bien, en mal, ou sans opinion.
 */
const BONS = [
  'excellent', 'excellente', 'recommande', 'recommandee', 'qualite', 'artisanal', 'artisanale',
  'reference', 'reputee', 'reputation', 'soigne', 'soignee', 'naturel', 'naturelle',
  'empfehlenswert', 'hochwertig', 'beliebt', 'ottimo', 'consigliato', 'recommended', 'quality',
]
const RESERVES = [
  'cher', 'chere', 'limite', 'limitee', 'peu', 'manque', 'absence', 'difficile', 'lent',
  'teuer', 'begrenzt', 'costoso', 'limitato', 'expensive', 'limited', 'lacks',
]

export function classerSentiment(extrait: string): string {
  const plat = aplatir(extrait)
  const mots = new Set(plat.split(' '))
  const bon = BONS.some((mot) => mots.has(mot))
  const reserve = RESERVES.some((mot) => mots.has(mot))
  if (bon && !reserve) return 'bon'
  if (reserve && !bon) return 'reserve'
  return 'neutre'
}

/** Le tarif d'un relevé, tel que l'exploitant l'a réglé. */
async function coutDuReleve(): Promise<number> {
  const couts = await actionCosts()
  const ligne = couts.find((cout: ActionCost) => cout.id === ACTION_RELEVE)
  return ligne === undefined ? COUT_PAR_DEFAUT : Math.max(1, ligne.max)
}

/** Les questions suivies pour un site. */
export async function listerPrompts(userId: string, siteId: string): Promise<PromptSuivi[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.promptIA.findMany({
      where: { siteId, userId },
      orderBy: [{ theme: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, texte: true, theme: true, actif: true },
    }),
  )
  return lignes
}

/** Ajoute une question. Le doublon est refusé : il doublerait la facture pour rien. */
export async function ajouterPrompt(
  userId: string,
  siteId: string,
  texte: string,
  theme: string,
): Promise<PromptSuivi> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { id: siteId, userId, deletedAt: null }, select: { id: true } }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const propre = texte.trim().slice(0, 300)
  if (propre.length < 8) throw validation('Écrivez la question telle qu’un client la poserait.')

  const deja = await withUserScope(userId, (tx) =>
    tx.promptIA.count({ where: { siteId, userId } }),
  )
  if (deja >= PROMPTS_MAX) {
    throw validation(`Vous suivez déjà ${PROMPTS_MAX} questions. Éteignez-en une pour en ajouter.`)
  }

  const existe = await withUserScope(userId, (tx) =>
    tx.promptIA.findFirst({ where: { siteId, texte: propre }, select: { id: true } }),
  )
  if (existe !== null) throw validation('Cette question est déjà suivie.')

  return withUserScope(userId, (tx) =>
    tx.promptIA.create({
      data: { siteId, userId, texte: propre, theme: theme.trim().slice(0, 60) },
      select: { id: true, texte: true, theme: true, actif: true },
    }),
  )
}

/** Allume ou éteint une question. Éteinte, elle garde son historique et cesse d'être facturée. */
export async function basculerPrompt(
  userId: string,
  promptId: string,
  actif: boolean,
): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.promptIA.updateMany({ where: { id: promptId, userId }, data: { actif } }),
  )
}

export async function supprimerPrompt(userId: string, promptId: string): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.promptIA.deleteMany({ where: { id: promptId, userId } }),
  )
}

export type BilanReleve = {
  /** Questions réellement posées. */
  questions: number
  /** Relevés obtenus, toutes plateformes et répétitions confondues. */
  releves: number
  mentions: number
  /** Crédits réellement débités. */
  credits: number
  /** Plateformes interrogées, telles qu'elles l'ont été. */
  plateformes: Plateforme[]
}

/**
 * Pose toutes les questions actives d'un site, sur toutes les plateformes configurées.
 *
 * Le coût est réservé d'abord, au plafond, puis ajusté au nombre de relevés réellement
 * obtenus : une plateforme injoignable ne doit pas être facturée. C'est la même mécanique
 * que le reste du produit — réserver large, débiter juste.
 */
export async function releverVisibilite(userId: string, siteId: string): Promise<BilanReleve> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { host: true, label: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const prompts = await withUserScope(userId, (tx) =>
    tx.promptIA.findMany({
      where: { siteId, userId, actif: true },
      select: { id: true, texte: true },
      take: PROMPTS_MAX,
    }),
  )
  const plateformes = plateformesDisponibles()
  if (prompts.length === 0 || plateformes.length === 0) {
    return { questions: 0, releves: 0, mentions: 0, credits: 0, plateformes }
  }

  const tarif = await coutDuReleve()
  const plafond = prompts.length * tarif
  const reservation = await reserveCredits({
    userId,
    operation: ACTION_RELEVE,
    amount: plafond,
  })

  const formes = formesDuNom(site.host, site.label)
  let releves = 0
  let mentions = 0
  const questionsAbouties = new Set<string>()

  try {
    for (const prompt of prompts) {
      for (const plateforme of plateformes) {
        for (let tour = 0; tour < REPETITIONS; tour += 1) {
          const reponse = await demander(plateforme, prompt.texte)
          if (!reponse.ok) continue

          const { mentionne, extrait } = chercherMention(reponse.texte, formes)
          releves += 1
          questionsAbouties.add(prompt.id)
          if (mentionne) mentions += 1

          await withUserScope(userId, (tx) =>
            tx.releveIA.create({
              data: {
                promptId: prompt.id,
                siteId,
                userId,
                plateforme,
                mentionne,
                sentiment: mentionne ? classerSentiment(extrait) : 'inconnu',
                extrait,
                sources: reponse.sources.slice(0, 10),
              },
            }),
          )
        }
      }
    }
  } finally {
    await releaseReservation(reservation.id)
  }

  /*
   * Facturé à la question aboutie, pas au relevé : la personne a demandé à savoir si elle
   * sort sur cette question-là. Le nombre de plateformes et de répétitions est une décision
   * d'Evoliia, pas la sienne, et lui en faire porter le compte reviendrait à lui facturer
   * nos réglages.
   */
  const credits = questionsAbouties.size * tarif
  if (credits > 0) await spendCredits(userId, credits, `ia:${ACTION_RELEVE}`)

  logger.info('visibilité IA relevée', {
    questions: questionsAbouties.size,
    releves,
    mentions,
    plateformes: plateformes.length,
  })

  return { questions: questionsAbouties.size, releves, mentions, credits, plateformes }
}

/**
 * Ce qu'on sait, question par question, sur une fenêtre donnée.
 *
 * Une fréquence et non un état : « vue dans 3 relevés sur 10 » se regarde bouger, « vue »
 * serait un verdict que la donnée ne porte pas.
 */
export async function lireFrequences(
  userId: string,
  siteId: string,
  jours = 30,
): Promise<Fréquence[]> {
  const depuis = new Date(Date.now() - jours * 24 * 60 * 60 * 1000)
  const prompts = await listerPrompts(userId, siteId)

  const releves = await withUserScope(userId, (tx) =>
    tx.releveIA.findMany({
      where: { siteId, userId, createdAt: { gte: depuis } },
      select: { promptId: true, mentionne: true, sentiment: true, sources: true },
    }),
  )

  return prompts.map((prompt) => {
    const siens = releves.filter((releve) => releve.promptId === prompt.id)
    const cites = siens.filter((releve) => releve.mentionne)

    const tons = new Map<string, number>()
    for (const releve of cites) tons.set(releve.sentiment, (tons.get(releve.sentiment) ?? 0) + 1)
    const sentiment = [...tons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'inconnu'

    const vues = new Map<string, number>()
    for (const releve of siens) {
      const liste = Array.isArray(releve.sources) ? releve.sources : []
      for (const source of liste) {
        if (typeof source !== 'string') continue
        vues.set(source, (vues.get(source) ?? 0) + 1)
      }
    }
    const sources = [...vues.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([url]) => url)

    return { prompt, releves: siens.length, mentions: cites.length, sentiment, sources }
  })
}

/** Le solde suffit-il pour un passage complet ? Sert à ne pas lancer ce qui finira à sec. */
export async function soldeCouvre(userId: string, questions: number): Promise<boolean> {
  if (questions === 0) return false
  return (await availableCredits(userId)) >= questions * (await coutDuReleve())
}

/** Une question proposée, pas encore suivie. Rien n'est enregistré tant qu'on n'a pas choisi. */
export type QuestionProposee = {
  question: string
  theme: string
  langue: string
  fondement: string
}

/**
 * Propose des questions à partir des chiffres réels et du catalogue.
 *
 * Inventer vingt questions qu'un client poserait à une IA est exactement ce que la personne
 * ne sait pas faire : elle connaît son métier, pas les formulations qu'on tape dans un
 * assistant. Les matériaux, eux, sont déjà là — ce que les gens ont tapé sur Google pour la
 * trouver, et ce que sa boutique vend.
 *
 * Rien n'est enregistré. La liste est proposée, la personne en garde ce qu'elle veut : une
 * question qu'elle n'aurait pas choisie serait une mesure qu'elle paierait sans l'avoir
 * décidée.
 *
 * Les questions déjà suivies partent avec la demande, pour ne pas les reproposer — la même
 * mesure payée deux fois est la façon la plus sûre de faire regretter une fonctionnalité.
 */
export async function proposerQuestions(
  userId: string,
  siteId: string,
  locale: string,
  combien = 12,
): Promise<QuestionProposee[]> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { host: true, origin: true, about: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const [recherches, vitrine, deja] = await Promise.all([
    recherchesPourArticle(userId, site.origin),
    lireVitrinePourArticle(userId).catch(() => []),
    listerPrompts(userId, siteId),
  ])

  const resultat = await suggestQuestions({
    userId,
    host: site.host,
    about: site.about,
    locale,
    recherches,
    fiches: vitrine.slice(0, 20).map((fiche: { titre: string }) => fiche.titre),
    deja: deja.map((prompt: PromptSuivi) => prompt.texte),
    combien: Math.min(24, Math.max(3, combien)),
  })

  /*
   * Une question qui nomme la marque est écartée ici, et pas seulement demandée dans la
   * consigne. Elle mesurerait si l'assistant sait lire la question qu'on vient de lui
   * poser — autant se féliciter d'avoir répondu à soi-même. Une consigne se respecte
   * presque toujours ; « presque » ne suffit pas quand la mesure est ensuite facturée.
   */
  const formes = formesDuNom(site.host, site.host)
  return resultat.value.questions
    .filter((proposee: QuestionProposee) => !chercherMention(proposee.question, formes).mentionne)
    .map((proposee: QuestionProposee) => ({
      question: proposee.question.trim().slice(0, 300),
      theme: proposee.theme.trim().slice(0, 60),
      langue: proposee.langue.trim().slice(0, 5),
      fondement: proposee.fondement.trim().slice(0, 200),
    }))
    .filter((proposee: QuestionProposee) => proposee.question.length >= 8)
}
