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
 * **Le coût est réservé avant d'être engagé, et il suit les plateformes.** Chaque relevé
 * est un appel payant à une plateforme extérieure, et chacun choisit les siennes : le prix
 * se compte donc par question **et par assistant**. Le forfait d'avant, toutes plateformes
 * confondues, faisait payer pareil un suivi sur trois assistants et un suivi sur six — et
 * faisait absorber la différence à Evoliia, sur une facture qui ne se voit qu'à la banque.
 * Le tarif vient du catalogue administrable, jamais du code.
 *
 * **On ne mesure que ce qu'on interroge vraiment.** Voir `assistants.ts` : pas les encadrés
 * IA de Google ni son mode conversationnel, faute d'API — les lire demanderait de racler
 * des pages de résultats, et Evoliia détient déjà les jetons Google de ses clients.
 */

/** L'action facturée, telle qu'elle apparaît dans le catalogue de l'exploitant. */
export const ACTION_RELEVE = 'visibilite-ia-plateforme'

/**
 * Le tarif de repli, employé seulement si le catalogue ne dit rien.
 *
 * Un crédit par question **et par assistant** : à trois assistants suivis, c'est exactement
 * ce que coûtait l'ancien forfait. Le changement d'unité ne devait renchérir le relevé de
 * personne — il devait seulement cesser de faire payer à Evoliia les plateformes ajoutées.
 */
const COUT_PAR_DEFAUT = 1

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

/**
 * Les assistants réellement interrogés pour ce site.
 *
 * Deux filtres, et l'ordre compte. Le choix de la personne d'abord ; la disponibilité
 * ensuite. Une plateforme choisie dont la clé n'est pas posée ne doit pas être interrogée —
 * elle échouerait à chaque tour — et surtout pas facturée : on ne fait pas payer une colonne
 * vide.
 *
 * Liste vide : toutes celles qui sont disponibles. C'est l'état de tous les sites existants
 * au moment où cette colonne apparaît, et c'est exactement ce qu'ils faisaient avant.
 *
 * Une valeur inconnue est ignorée plutôt que rattrapée. Un nom de plateforme retiré du code
 * resterait sinon en base pour toujours, et ferait facturer un assistant qui n'existe plus.
 */
export async function plateformesSuivies(
  userId: string,
  siteId: string,
): Promise<Plateforme[]> {
  const disponibles = plateformesDisponibles()
  const reglages = await withUserScope(userId, (tx) =>
    tx.siteAutomatisation.findFirst({
      where: { siteId, userId },
      select: { plateformesIA: true },
    }),
  )

  const choisies = reglages?.plateformesIA ?? []
  if (choisies.length === 0) return disponibles
  return disponibles.filter((une) => choisies.includes(une))
}

/**
 * Enregistre les assistants suivis pour ce site.
 *
 * Refuse la liste vide, et ce refus est le garde-fou : vide veut dire « toutes », donc
 * décocher la dernière case reviendrait à toutes les rallumer et à tripler la note de
 * quelqu'un qui cherchait à la réduire. Pour ne plus rien interroger, on éteint le relevé
 * automatique ou on éteint ses questions — deux gestes qui disent ce qu'ils font.
 *
 * Ce qui arrive du navigateur est filtré sur la liste du code, jamais repris tel quel.
 */
export async function choisirPlateformes(
  userId: string,
  siteId: string,
  demandees: readonly string[],
): Promise<Plateforme[]> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { id: siteId, userId, deletedAt: null }, select: { id: true } }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const disponibles = plateformesDisponibles()
  const retenues = disponibles.filter((une) => demandees.includes(une))
  if (retenues.length === 0) {
    throw validation('Gardez au moins un assistant, ou éteignez le relevé automatique.')
  }

  await withUserScope(userId, (tx) =>
    tx.siteAutomatisation.upsert({
      where: { siteId },
      create: { siteId, userId, plateformesIA: retenues },
      update: { plateformesIA: retenues },
    }),
  )
  return retenues
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
 * Au-delà, un passage commencé est considéré comme interrompu et se reprend.
 *
 * Un serveur peut être coupé au milieu : un déploiement, une fonction qui atteint sa durée,
 * une panne. Sans cette borne, un passage tué à mi-chemin resterait « en cours » pour
 * toujours et bloquerait le suivant.
 */
const PASSAGE_ABANDONNE_MS = 30 * 60 * 1000

/** Ce qu'un passage laisse voir de son avancement. */
export type EtatPassage = {
  enCours: boolean
  attendu: number
  fait: number
}

/** Les questions de ce passage qui n'ont pas encore de réponse. */
async function resteAFaire(
  userId: string,
  siteId: string,
  depuis: Date,
): Promise<{ id: string; texte: string }[]> {
  const prompts = await withUserScope(userId, (tx) =>
    tx.promptIA.findMany({
      where: { siteId, userId, actif: true },
      select: { id: true, texte: true },
      take: PROMPTS_MAX,
    }),
  )
  const faits = await withUserScope(userId, (tx) =>
    tx.releveIA.findMany({
      where: { siteId, userId, createdAt: { gte: depuis } },
      select: { promptId: true },
      distinct: ['promptId'],
    }),
  )
  const vus = new Set(faits.map((ligne: { promptId: string }) => ligne.promptId))
  return prompts.filter((prompt: { id: string }) => !vus.has(prompt.id))
}

/**
 * Où en est le passage en cours, s'il y en a un.
 *
 * L'avancement se compte sur les relevés réellement écrits, jamais sur un compteur tenu à
 * part : deux nombres qui disent la même chose finissent toujours par se contredire, et
 * c'est celui qui ment qu'on affiche.
 */
export async function etatPassage(userId: string, siteId: string): Promise<EtatPassage> {
  const reglages = await withUserScope(userId, (tx) =>
    tx.siteAutomatisation.findFirst({
      where: { siteId, userId },
      select: { passageAt: true, passageAttendu: true },
    }),
  )
  if (reglages?.passageAt == null) return { enCours: false, attendu: 0, fait: 0 }

  const faits = await withUserScope(userId, (tx) =>
    tx.releveIA.findMany({
      where: { siteId, userId, createdAt: { gte: reglages.passageAt as Date } },
      select: { promptId: true },
      distinct: ['promptId'],
    }),
  )
  const abandonne = Date.now() - reglages.passageAt.getTime() > PASSAGE_ABANDONNE_MS
  return {
    enCours: !abandonne && faits.length < reglages.passageAttendu,
    attendu: reglages.passageAttendu,
    fait: faits.length,
  }
}

/**
 * Ouvre un passage : marque qu'il commence, et dit ce qu'il va couvrir.
 *
 * Rien n'est interrogé ici. C'est délibéré : la réponse doit partir tout de suite, pour que
 * la personne puisse fermer l'onglet. Le travail, lui, continue après — et ce qu'il a fait
 * est durable, chaque réponse étant écrite dès qu'elle arrive.
 */
export async function ouvrirPassage(userId: string, siteId: string): Promise<EtatPassage> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { id: siteId, userId, deletedAt: null }, select: { id: true } }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const en = await etatPassage(userId, siteId)
  if (en.enCours) return en

  const [questions, plateformes] = [
    await withUserScope(userId, (tx) =>
      tx.promptIA.count({ where: { siteId, userId, actif: true } }),
    ),
    await plateformesSuivies(userId, siteId),
  ]
  if (questions === 0 || plateformes.length === 0) {
    return { enCours: false, attendu: 0, fait: 0 }
  }
  if (!(await soldeCouvre(userId, questions, plateformes.length))) {
    throw validation(
      'Votre solde ne couvre pas ce relevé. Éteignez des questions, ou attendez le renouvellement.',
    )
  }

  await withUserScope(userId, (tx) =>
    tx.siteAutomatisation.upsert({
      where: { siteId },
      create: { siteId, userId, passageAt: new Date(), passageAttendu: questions },
      update: { passageAt: new Date(), passageAttendu: questions },
    }),
  )
  return { enCours: true, attendu: questions, fait: 0 }
}

/**
 * Pose les questions du passage en cours, dans la limite du temps accordé.
 *
 * Reprenable : ce qui reste à faire se déduit des relevés déjà écrits, donc un appel coupé
 * au milieu ne perd rien et le suivant continue là où il en était. C'est ce qui permet de
 * fermer l'onglet — et ce qui rend le travail insensible à une fonction qui atteint sa
 * durée maximale.
 *
 * Le coût est réservé au plafond puis ajusté aux questions réellement abouties : une
 * plateforme injoignable ne doit pas être facturée.
 */
export async function poursuivrePassage(
  userId: string,
  siteId: string,
  budgetMs = 240_000,
): Promise<BilanReleve> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { host: true, label: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const reglages = await withUserScope(userId, (tx) =>
    tx.siteAutomatisation.findFirst({
      where: { siteId, userId },
      select: { passageAt: true },
    }),
  )
  const plateformes = await plateformesSuivies(userId, siteId)
  if (reglages?.passageAt == null || plateformes.length === 0) {
    return { questions: 0, releves: 0, mentions: 0, credits: 0, plateformes }
  }

  const prompts = await resteAFaire(userId, siteId, reglages.passageAt)
  if (prompts.length === 0) {
    return { questions: 0, releves: 0, mentions: 0, credits: 0, plateformes }
  }

  const tarif = await coutDuReleve()
  /*
   * Le plafond couvre ce que le passage peut coûter au pire : chaque question posée à
   * chaque assistant suivi. Les répétitions n'y entrent pas — poser deux fois la même
   * question est notre façon de mesurer une réponse qui varie, pas un service de plus.
   */
  const plafond = prompts.length * plateformes.length * tarif
  const reservation = await reserveCredits({
    userId,
    operation: ACTION_RELEVE,
    amount: plafond,
  })

  const formes = formesDuNom(site.host, site.label)
  const limite = Date.now() + budgetMs
  let releves = 0
  let mentions = 0
  const questionsAbouties = new Set<string>()

  try {
    for (const prompt of prompts) {
      /*
       * On s'arrête sur une question entière, jamais au milieu : une question à moitié
       * posée serait facturée pour une mesure incomplète. Le reste se reprend.
       */
      if (Date.now() >= limite) break
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
   * Facturé à la question aboutie et par assistant suivi.
   *
   * Les répétitions restent hors du compte : elles sont notre façon de mesurer une réponse
   * qui varie, et les facturer reviendrait à faire payer nos réglages. Le nombre
   * d'assistants, lui, est un choix de la personne depuis qu'elle peut le faire — et il
   * décide directement de ce qu'Evoliia paie dehors.
   *
   * Compté sur les assistants suivis et non sur les relevés réellement écrits : une
   * plateforme momentanément injoignable ne doit pas faire baisser la note d'un centime de
   * plus que ce qu'elle a coûté, mais une question aboutie ailleurs a bien été mesurée.
   */
  const credits = questionsAbouties.size * plateformes.length * tarif
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
export async function soldeCouvre(
  userId: string,
  questions: number,
  plateformes: number,
): Promise<boolean> {
  if (questions === 0 || plateformes === 0) return false
  return (await availableCredits(userId)) >= questions * plateformes * (await coutDuReleve())
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

// ───────────────────────── Le tableau de bord ────────────────────────────────

/**
 * Ce qu'on peut dire honnêtement d'une période, et ce qu'on ne dira pas.
 *
 * Trois chiffres par plateforme — des relevés, des mentions, et le rapport des deux — plus
 * une variation contre la période précédente de même durée. C'est tout ce que la donnée
 * porte, et c'est déjà beaucoup : une fréquence qui passe de 20 % à 35 % sur trois mois est
 * une information que personne d'autre ne donne.
 *
 * Ce qui n'y figure pas mérite d'être dit : aucune « part de voix ». Une part de voix
 * suppose de compter les mentions de chaque marque dans chaque réponse, donc de décider ce
 * qui est une marque — et de le faire assez bien pour qu'un pourcentage veuille dire quelque
 * chose. Ce qu'on a, ce sont les pages que les assistants citent. C'est un fait, pas une
 * estimation, et c'est sous ce nom qu'il est rendu.
 */
export type CartePlateforme = {
  plateforme: Plateforme
  releves: number
  mentions: number
  /** Part des relevés où la marque apparaît, en pourcentage entier. */
  frequence: number
  /** Écart de fréquence avec la période précédente, ou `null` s'il n'y a rien à comparer. */
  variation: number | null
  /** Fréquence par semaine, de la plus ancienne à la plus récente. Pour la courbe. */
  serie: number[]
}

export type SiteCite = {
  domaine: string
  citations: number
  /** Vrai quand c'est le site de la personne. */
  sien: boolean
}

export type TableauIA = {
  jours: number
  plateformes: CartePlateforme[]
  /** Toutes plateformes confondues. */
  releves: number
  mentions: number
  frequence: number
  variation: number | null
  /** Questions citées sur toutes les plateformes interrogées. */
  citeesPartout: number
  questions: number
  sentiment: string
  /** Les pages citées par les assistants, la sienne comprise, les plus vues d'abord. */
  sites: SiteCite[]
  /** Le nombre d'adresses distinctes citées : la taille du terrain. */
  sourcesUniques: number
}

/** Le domaine d'une adresse, sans « www. », ou une chaîne vide si elle est illisible. */
function domaineDe(adresse: string): string {
  try {
    return new URL(adresse).hostname.replace(/^www\./u, '').toLowerCase()
  } catch {
    return ''
  }
}

function pourcent(mentions: number, releves: number): number {
  return releves === 0 ? 0 : Math.round((mentions / releves) * 100)
}

/**
 * Le tableau de bord d'une période.
 *
 * La période précédente est lue en même temps, et de même durée : « 35 % » ne dit rien,
 * « 35 %, contre 22 % le mois d'avant » dit tout. C'est la seule façon de rendre un chiffre
 * de visibilité utile — il ne se juge pas dans l'absolu, personne ne sait ce qu'est une
 * bonne fréquence dans un assistant.
 */
export async function tableauIA(userId: string, siteId: string, jours = 30): Promise<TableauIA> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { host: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const maintenant = Date.now()
  const debut = new Date(maintenant - jours * 24 * 60 * 60 * 1000)
  const debutAvant = new Date(maintenant - 2 * jours * 24 * 60 * 60 * 1000)

  const lignes = await withUserScope(userId, (tx) =>
    tx.releveIA.findMany({
      where: { siteId, userId, createdAt: { gte: debutAvant } },
      select: {
        promptId: true,
        plateforme: true,
        mentionne: true,
        sentiment: true,
        sources: true,
        createdAt: true,
      },
    }),
  )

  const actuels = lignes.filter((ligne) => ligne.createdAt >= debut)
  const anciens = lignes.filter((ligne) => ligne.createdAt < debut)

  const plateformes: CartePlateforme[] = []
  for (const plateforme of plateformesDisponibles()) {
    const siens = actuels.filter((ligne) => ligne.plateforme === plateforme)
    const avant = anciens.filter((ligne) => ligne.plateforme === plateforme)
    const mentions = siens.filter((ligne) => ligne.mentionne).length
    const frequence = pourcent(mentions, siens.length)

    /*
     * La courbe est hebdomadaire, quelle que soit la fenêtre : un point par jour sur trente
     * jours montrerait surtout l'aléa des assistants, qui est ce qu'on veut lisser.
     */
    const semaines = Math.max(1, Math.ceil(jours / 7))
    const serie: number[] = []
    for (let rang = semaines - 1; rang >= 0; rang -= 1) {
      const fin = new Date(maintenant - rang * 7 * 24 * 60 * 60 * 1000)
      const ouverture = new Date(fin.getTime() - 7 * 24 * 60 * 60 * 1000)
      const tranche = siens.filter(
        (ligne) => ligne.createdAt >= ouverture && ligne.createdAt < fin,
      )
      serie.push(pourcent(tranche.filter((ligne) => ligne.mentionne).length, tranche.length))
    }

    plateformes.push({
      plateforme,
      releves: siens.length,
      mentions,
      frequence,
      variation:
        avant.length === 0
          ? null
          : frequence - pourcent(avant.filter((ligne) => ligne.mentionne).length, avant.length),
      serie,
    })
  }

  const mentions = actuels.filter((ligne) => ligne.mentionne).length
  const frequence = pourcent(mentions, actuels.length)
  const frequenceAvant =
    anciens.length === 0
      ? null
      : pourcent(anciens.filter((ligne) => ligne.mentionne).length, anciens.length)

  /*
   * Citée partout : la question sort sur chaque plateforme interrogée. C'est le seul cas où
   * l'on peut dire qu'une marque « est visible » sur un sujet sans forcer le mot.
   */
  const parQuestion = new Map<string, Set<string>>()
  for (const ligne of actuels) {
    if (!ligne.mentionne) continue
    const vues = parQuestion.get(ligne.promptId) ?? new Set<string>()
    vues.add(ligne.plateforme)
    parQuestion.set(ligne.promptId, vues)
  }
  const attendues = plateformes.filter((carte) => carte.releves > 0).length
  const citeesPartout = [...parQuestion.values()].filter(
    (vues) => attendues > 0 && vues.size >= attendues,
  ).length

  const tons = new Map<string, number>()
  for (const ligne of actuels) {
    if (!ligne.mentionne) continue
    tons.set(ligne.sentiment, (tons.get(ligne.sentiment) ?? 0) + 1)
  }
  const sentiment = [...tons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'inconnu'

  const sien = site.host.replace(/^www\./u, '').toLowerCase()
  const citations = new Map<string, number>()
  for (const ligne of actuels) {
    const liste = Array.isArray(ligne.sources) ? ligne.sources : []
    for (const source of liste) {
      if (typeof source !== 'string') continue
      const domaine = domaineDe(source)
      if (domaine === '') continue
      citations.set(domaine, (citations.get(domaine) ?? 0) + 1)
    }
  }
  const sites = [...citations.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([domaine, nombre]) => ({ domaine, citations: nombre, sien: domaine === sien }))

  return {
    jours,
    plateformes,
    releves: actuels.length,
    mentions,
    frequence,
    variation: frequenceAvant === null ? null : frequence - frequenceAvant,
    citeesPartout,
    questions: parQuestion.size,
    sentiment,
    sites,
    sourcesUniques: citations.size,
  }
}
