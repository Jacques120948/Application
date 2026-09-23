import { contextePublicitaire } from '@/server/ads/contexte'
import { lireNova } from '@/server/nova/service'
import { faitsNova, transmissionOria } from '@/server/nova/contexte'
import { lireLina } from '@/server/lina/service'
import { faitsLina, transmissionOria as transmissionLina } from '@/server/lina/contexte'
import { contenusPourMilo, conversionPourCleo, pagesSeoPourNeo, traficAssistantsPourGia } from '@/server/nova/transmission'
import { lireSignaux } from '@/server/oria/signaux'
import { lireDecisions } from '@/server/oria/decisions'
import { comparer, lireBudgets, lirePlateformes, repartition, NOM_POSTE } from '@/server/oria/budget'
import { OBJECTIFS } from '@/lib/objectifs'
import { contexteMeta } from '@/server/ads/contexte-meta'
import { listAudits, readPlan } from '@/server/audit/plan'
import { JOURS_LUS, recherchesPourArticle } from '@/server/audit/recherches'
import { withUserScope } from '@/server/db/scope'
import type { VisibilityAgentId } from './visibility'

/**
 * Ce que chaque spécialiste de la visibilité a le droit de lire.
 *
 * Trois raisons, et la première n'est pas technique.
 *
 * **Un spécialiste qui voit tout n'est pas un spécialiste.** C'est un assistant généraliste
 * avec un prénom, et cela se sent au bout de trois échanges : il répond à côté, il mélange
 * les sujets, il donne un avis sur ce qu'il n'a pas regardé. Néo voit les constats de
 * référencement et les balises des pages ; Gia voit ce qu'une machine comprend ; Milo voit
 * le texte. Chacun répond mieux de moins.
 *
 * **Tout ce qui sort d'ici est mesuré.** Un titre existe ou n'existe pas, une note vaut 69
 * ou elle n'est pas calculée. Il n'y a ni estimation, ni moyenne de marché, ni
 * « probablement ». Quand la donnée manque, c'est écrit en toutes lettres, et la consigne du
 * spécialiste est de le dire plutôt que de combler.
 *
 * **Un contexte plus large coûte plus cher à chaque question, pour une réponse moins nette.**
 * Donner les quatre périmètres à chacun multiplierait la facture par quatre sans rien
 * améliorer.
 *
 * Les chiffres de recherche suivent la même règle et ne vont donc qu'à deux d'entre eux.
 * Néo, parce qu'une position est un fait de référencement et que c'est lui qui réécrit les
 * balises des pages concernées. Milo, parce que c'est lui qui écrit, et qu'écrire sur ce que
 * les gens tapent vaut mieux qu'écrire sur ce que le site ne couvre pas. Léa dit par quoi
 * commencer à partir des constats, Gia regarde ce qu'une machine comprend : ni l'une ni
 * l'autre n'en ferait quelque chose, et le contexte se paie à chaque question.
 */

/** Au-delà, le contexte coûte plus qu'il n'éclaire. */
const CONSTATS_MAX = 10
/**
 * Les points qu'Oria reçoit.
 *
 * Douze, et pas trente : elle n'en citera jamais plus de trois, et lui en donner trente
 * l'inviterait à en choisir trois au hasard plutôt que les trois premiers. Le compte total
 * lui est dit à part, pour qu'elle puisse écrire « il en reste dix-neuf ».
 */
const SIGNAUX_MAX = 12

/** Les décisions qu'Oria garde en tête. Au-delà, c'est de l'histoire, pas du contexte. */
const DECISIONS_MAX = 8

/** Le prénom derrière chaque identifiant, pour qu'Oria nomme ses collègues. */
const NOMS_AGENTS: readonly (readonly [string, string])[] = [
  ['audit', 'Léa'],
  ['seo', 'Néo'],
  ['geo', 'Gia'],
  ['content', 'Milo'],
  ['cro', 'Cleo'],
  ['ads', 'Naya'],
  ['meta', 'MIRA'],
  ['nova', 'Nova'],
  ['lina', 'Lina'],
]
const PAGES_MAX = 12
const ANALYSES_MAX = 6

function ligneConstat(ligne: {
  label: string
  severity: string
  affected: number
  examined: number
  scope: string
  state: string
}): string {
  const etendue = ligne.scope === 'site' ? 'tout le site' : `${ligne.affected}/${ligne.examined} pages`
  const etat =
    ligne.state === 'done'
      ? ' [marqué corrigé]'
      : ligne.state === 'doing'
        ? ' [en cours]'
        : ligne.state === 'ignored'
          ? ' [ignoré]'
          : ''
  return `- ${ligne.label} (${ligne.severity}, ${etendue})${etat}`
}

/** L'en-tête commun : de quel site on parle, et où il en est. */
async function enTete(userId: string, siteId: string): Promise<string[]> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { host: true, label: true, about: true },
    }),
  )
  if (site === null) return ['Site introuvable.']

  const analyses = await listAudits(userId, siteId, ANALYSES_MAX)
  const derniere = analyses[0]

  const lignes = [
    `Site : ${site.label} (${site.host}).`,
    site.about.trim() === ''
      ? "Le créateur n'a rien écrit sur son activité. N'en déduis rien."
      : `Ce que le créateur dit de son activité : ${site.about}`,
  ]
  if (derniere === undefined) {
    lignes.push("Aucune analyse terminée : tu ne disposes d'aucun constat mesuré.")
    return lignes
  }
  lignes.push(
    `Dernière analyse : ${derniere.pagesCrawled} pages lues. Note de référencement ${derniere.seoScore ?? 'non calculée'}/100, note « moteurs IA » ${derniere.geoScore ?? 'non calculée'}/100, note « conversion » ${derniere.croScore ?? 'non calculée'}/100.`,
  )
  if (analyses.length > 1) {
    lignes.push(
      `Évolution (de la plus ancienne à la plus récente) : ${[...analyses]
        .reverse()
        .map((analyse) => `${analyse.seoScore ?? '?'}/${analyse.geoScore ?? '?'}`)
        .join(' → ')} (référencement/moteurs IA).`,
    )
  }
  return lignes
}

/** Les constats du plan, filtrés par moteur. Léa les voit tous. */
async function constats(
  userId: string,
  siteId: string,
  moteur: 'seo' | 'geo' | 'cro' | null,
): Promise<string[]> {
  const plan = await readPlan(userId, siteId)
  if (plan === null || plan.lignes.length === 0) {
    return ['Aucun point à corriger dans ce périmètre.']
  }
  const retenues = plan.lignes
    .filter((ligne) => moteur === null || ligne.engine === moteur)
    .slice(0, CONSTATS_MAX)
  if (retenues.length === 0) return ['Aucun point à corriger dans ce périmètre.']
  return ['Constats mesurés, du plus coûteux au moins :', ...retenues.map(ligneConstat)]
}

/** Un échantillon de pages, avec ce que chaque spécialiste a besoin d'en voir. */
async function pages(
  userId: string,
  siteId: string,
  quoi: 'balises' | 'machine' | 'texte' | 'conversion',
): Promise<string[]> {
  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    }),
  )
  if (audit === null) return []

  const relevees = await withUserScope(userId, (tx) =>
    tx.auditPage.findMany({
      where: { auditId: audit.id },
      orderBy: [{ depth: 'asc' }, { path: 'asc' }],
      take: PAGES_MAX,
      select: { path: true, title: true, description: true, wordCount: true, signals: true },
    }),
  )
  if (relevees.length === 0) return []

  type Releve = {
    h1?: string[]
    intro?: string
    schemaTypes?: string[]
    headings?: { level: number; text: string }[]
    lists?: number
    tables?: number
    author?: string
    boutons?: number
    premierBouton?: string
    formulaires?: number
    champsMax?: number
    prix?: boolean
    avisDeclares?: boolean
    reassurance?: string[]
    hasViewport?: boolean
  }

  const decrire = (page: (typeof relevees)[number]): string => {
    const signaux = (page.signals as unknown as Releve | null) ?? {}
    if (quoi === 'balises') {
      return `- ${page.path} | title: ${page.title || '(absent)'} | description: ${page.description || '(absente)'} | h1: ${signaux.h1?.[0] ?? '(absent)'}`
    }
    if (quoi === 'machine') {
      const questions = (signaux.headings ?? []).filter(
        (titre) => titre.level >= 2 && titre.text.trim().endsWith('?'),
      ).length
      return `- ${page.path} | données structurées: ${(signaux.schemaTypes ?? []).join(', ') || '(aucune)'} | intertitres-questions: ${questions} | listes: ${signaux.lists ?? 0} | tableaux: ${signaux.tables ?? 0} | auteur: ${signaux.author || '(absent)'}`
    }
    if (quoi === 'conversion') {
      /*
       * Les relevés de conversion sont nés avec Cleo : un audit antérieur ne les porte pas.
       * « (non relevé) » n'est pas de la coquetterie — écrire « 0 bouton » sur une page qui
       * en a peut-être dix ferait dire à Cleo une chose fausse sur le ton du constat.
       */
      const ou = (valeur: number | undefined) => (valeur === undefined ? '(non relevé)' : valeur)
      const oui = (valeur: boolean | undefined) =>
        valeur === undefined ? '(non relevé)' : valeur ? 'oui' : 'non'
      return `- ${page.path} | boutons: ${ou(signaux.boutons)} | premier libellé: ${signaux.premierBouton === undefined ? '(non relevé)' : signaux.premierBouton || '(vide)'} | formulaires: ${ou(signaux.formulaires)} (champs max ${ou(signaux.champsMax)}) | prix visible: ${oui(signaux.prix)} | avis déclarés: ${oui(signaux.avisDeclares)} | réassurance: ${signaux.reassurance === undefined ? '(non relevé)' : signaux.reassurance.join(', ') || '(aucune)'} | mobile: ${oui(signaux.hasViewport)}`
    }
    return `- ${page.path} | ${page.wordCount} mots | h1: ${signaux.h1?.[0] ?? '(absent)'} | début: ${(signaux.intro ?? '').slice(0, 160) || '(aucun paragraphe substantiel)'}`
  }

  return [`Pages relevées (${relevees.length} sur les plus proches de l'accueil) :`, ...relevees.map(decrire)]
}

/**
 * Ce que les gens tapent réellement, quand Search Console est relié.
 *
 * Rend une liste vide sans connexion, sans propriété correspondante, ou si Google tarde :
 * la lecture est bornée dans le temps et ne fait jamais échouer une question. Quand elle
 * ne rend rien, le spécialiste reçoit une phrase qui le dit — parce qu'un silence se comble
 * par une estimation, et qu'une estimation est exactement ce que ce produit refuse.
 */
async function recherches(userId: string, siteId: string): Promise<string[]> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { origin: true },
    }),
  )
  if (site === null) return []

  const lignes = await recherchesPourArticle(userId, site.origin)
  if (lignes.length === 0) {
    return [
      "Aucune donnée de recherche n'est disponible pour ce site : ne parle ni de volume de recherche, ni de position dans Google, ni de concurrence. Tu ne les connais pas.",
    ]
  }
  return [
    `Recherches réelles relevées par Google sur les ${JOURS_LUS} derniers jours (les plus proches de la première page d'abord) :`,
    ...lignes.map(
      (ligne) =>
        `- « ${ligne.requete} » | ${ligne.impressions} affichages | ${ligne.clics} clics | position moyenne ${ligne.position}`,
    ),
  ]
}

/**
 * Les faits d'un spécialiste, prêts à être mis dans son contexte.
 *
 * Rien n'est calculé ici : tout vient des contrôles, qui sont du code. Ce module ne fait que
 * choisir ce que chacun a le droit de voir, et le mettre en phrases.
 */
export async function readSiteFacts(
  agent: VisibilityAgentId,
  userId: string,
  siteId: string,
): Promise<string> {
  const base = await enTete(userId, siteId)

  /*
   * Oria voit ce que les autres ont trouvé, et rien de ce qu'ils ont regardé.
   *
   * C'est la différence entre une directrice et un généraliste. On ne lui donne ni les
   * pages, ni les balises, ni les campagnes : on lui donne des constats déjà rendus, déjà
   * classés, avec le nom de celui qui les a rendus. Lui donner la matière première la
   * ferait refaire — plus mal, plus cher, et parfois en contredisant le spécialiste sur
   * l'écran d'à côté.
   *
   * L'ordre lui arrive fait. Il vient d'un calcul, pas d'un jugement : ce que le point
   * coûte, le travail qu'il demande, son urgence, la solidité des données derrière. Elle
   * l'explique, elle ne le refait pas — un classement refait à chaque question ne serait
   * plus un classement.
   *
   * Ce qu'on ne lit pas compte autant que ce qu'on lit : les agents dont aucune donnée
   * n'est arrivée sont nommés, pour qu'elle dise « aucun compte Meta n'est relié » plutôt
   * que de laisser un silence qu'un modèle comble toujours.
   */
  if (agent === 'oria') {
    /*
     * La langue ne sert qu'aux adresses des écrans, et les adresses ne vont pas au modèle :
     * Oria nomme un spécialiste, elle ne fabrique pas de lien.
     */
    const vue = await lireSignaux(userId, 'fr', siteId)
    const lignes = [...base]

    const manquants = NOMS_AGENTS.filter(
      ([id]) => !vue.sourcesLues.includes(id as VisibilityAgentId),
    )
    if (manquants.length > 0) {
      lignes.push(
        `SOURCES ABSENTES : ${manquants.map(([, nom]) => nom).join(', ')}. Tu ne disposes` +
          ` d'aucune donnée de leur part. Ne suppose rien à leur sujet ; quand la question` +
          ` en dépend, dis ce qu'il faudrait relier.`,
      )
    }

    const declares = vue.objectifs.objectifs
      .map((id) => OBJECTIFS.find((un) => un.id === id)?.label)
      .filter((label): label is string => label !== undefined)
    lignes.push(
      declares.length === 0
        ? 'Objectifs : aucun déclaré. Le classement est neutre ; si la question en dépend, propose d’en choisir un.'
        : `Objectifs déclarés, par ordre d'importance : ${declares.join(' ; ')}. Le classement en tient déjà compte.`,
    )
    if (vue.objectifs.activite !== '') {
      lignes.push(
        `Type d'activité : ${vue.objectifs.activite === 'boutique' ? 'boutique en ligne' : 'prestations de services'}` +
          `${vue.objectifs.deduite ? ' (déduit d’une boutique Shopify reliée)' : ''}.`,
      )
    }

    /*
     * Les chiffres de Nova, tels qu'elle les a calculés. Oria les cite et les classe ; elle
     * ne les recalcule jamais — deux calculs du même chiffre finissent toujours par diverger.
     */
    const nova = await lireNova(userId, 'fr', { periode: '30', siteId }).catch(() => null)
    if (nova !== null && !nova.vierge) lignes.push(...transmissionOria(nova))
    // Les opportunités de Lina sur les clients déjà acquis, chiffrées par elle.
    const lina = await lireLina(userId, { avecNova: false }).catch(() => null)
    if (lina !== null) lignes.push(...transmissionLina(lina))

    lignes.push(
      'État de chaque canal, calculé sur les notes et les constats ouverts :',
      ...vue.canaux.map((canal) => `- ${canal.nom} : ${canal.etat} — ${canal.pourquoi}`),
    )

    if (vue.signaux.length === 0) {
      lignes.push('Aucun point ouvert : rien n’attend de décision aujourd’hui.')
    } else {
      lignes.push(
        `Points ouverts, déjà classés du plus pressant au moins (${vue.signaux.length} en tout,` +
          ` les ${Math.min(vue.signaux.length, SIGNAUX_MAX)} premiers ici). Garde cet ordre.`,
        ...vue.signaux.slice(0, SIGNAUX_MAX).map((signal) => {
          const qui = signal.sources
            .map((source) => NOMS_AGENTS.find(([id]) => id === source)?.[1] ?? source)
            .join(' et ')
          return (
            `- [${qui}] ${signal.titre} | impact ${signal.impact}, effort ${signal.effort},` +
            ` urgence ${signal.urgence}, confiance ${signal.confiance} | ${signal.pourquoi}` +
            ` | ce qu'il y a à faire : ${signal.quoiFaire} | d'où ça sort : ${signal.mesure}`
          )
        }),
      )
    }

    /*
     * Le budget : ce qui est déclaré, et ce que la comparaison des régies permet de dire —
     * ou pourquoi elle ne le permet pas. Oria ne répond à « dois-je augmenter mes budgets ? »
     * qu'à partir de là, et renvoie à l'écran Budget pour la simulation.
     */
    if (vue.site !== null) {
      const [budgets, plateformes] = await Promise.all([
        lireBudgets(userId, vue.site.id).catch(() => ({})),
        lirePlateformes(userId).catch(() => []),
      ])
      const parts = repartition(budgets)
      lignes.push(
        parts.length === 0
          ? 'Budgets déclarés : aucun.'
          : `Budgets mensuels déclarés : ${parts.map((un) => `${NOM_POSTE[un.poste]} ${un.montant} (${Math.round(un.part * 100)} %)`).join(', ')}.`,
      )
      const comparaison = comparer(plateformes)
      lignes.push(
        comparaison.possible
          ? `Rentabilité comparée des régies : ${comparaison.fondement} ${comparaison.meilleure === null ? 'Rentabilités comparables.' : `Plus rentable : ${NOM_POSTE[comparaison.meilleure]}.`} Confiance ${comparaison.confiance}. Ne recommande jamais de modifier un budget sans renvoyer à l'écran Budget et à la confirmation chez Naya ou MIRA.`
          : `Rentabilité comparée des régies : impossible — ${comparaison.raison} Ne te prononce pas sur une réallocation.`,
      )
    }

    /*
     * Les décisions récentes, et ce qu'on a observé après. C'est sa mémoire : elle ne
     * repropose pas ce qui a été écarté, et elle peut dire « depuis que vous avez baissé ce
     * budget, on observe… » — avec le mot « observe », jamais « grâce à ».
     */
    const decisions = await lireDecisions(userId, vue.site?.id ?? null).catch(() => [])
    if (decisions.length > 0) {
      lignes.push(
        'Décisions récentes (les plus récentes d’abord). Ce qui a été écarté ne se repropose pas ;' +
          ' une évolution observée après une décision n’en est pas l’effet prouvé :',
        ...decisions.slice(0, DECISIONS_MAX).map((decision) => {
          const quand = decision.quand.toISOString().slice(0, 10)
          const impact =
            decision.impact === null
              ? ''
              : decision.impact.etat === 'mesure'
                ? ` | observé après, sur ${decision.impact.portee} : ${decision.impact.mesures
                    .map((mesure) => `${mesure.quoi} ${mesure.avant ?? '?'} → ${mesure.apres ?? '?'}`)
                    .join(', ')}`
                : ` | mesure : ${decision.impact.etat === 'en-attente' ? 'en attente' : 'indisponible'}`
          return `- ${quand} [${decision.genre}] ${decision.quoi}${impact}`
        }),
      )
    }

    return lignes.join('\n')
  }
  if (agent === 'audit') {
    // Léa voit tout, parce que son métier est de dire par quoi commencer. Elle ne voit
    // pas le détail des pages : ce n'est pas elle qui rédige.
    return [...base, ...(await constats(userId, siteId, null))].join('\n')
  }
  if (agent === 'seo') {
    const nova = await pagesSeoPourNeo(userId)
    return [
      ...base,
      ...(await constats(userId, siteId, 'seo')),
      ...(await pages(userId, siteId, 'balises')),
      ...(await recherches(userId, siteId)),
      ...(nova === null ? [] : [nova]),
    ].join('\n')
  }
  if (agent === 'geo') {
    const nova = await traficAssistantsPourGia(userId)
    return [
      ...base,
      ...(await constats(userId, siteId, 'geo')),
      ...(await pages(userId, siteId, 'machine')),
      ...(nova === null ? [] : [nova]),
    ].join('\n')
  }
  /*
   * Cleo voit ce qui se passe une fois la personne arrivée, et rien d'autre.
   *
   * Cette branche est explicite alors qu'elle pourrait tomber dans celle de Milo, et c'est
   * volontaire : elle y tombait, justement, et Cleo recevait le texte des pages avec les
   * constats des trois moteurs. Un spécialiste qui voit tout répond à côté, et celui-ci
   * aurait en plus commenté du référencement sous le titre « conversion ».
   *
   * La dernière ligne n'est pas une précaution de style. Sans Google Analytics, aucune mesure
   * de conversion n'existe : on le dit, sinon un modèle comble, et il comble avec un taux
   * inventé. Avec GA4, Nova donne les taux mesurés par appareil — et ceux-là seulement.
   */
  if (agent === 'cro') {
    const conversion = await conversionPourCleo(userId)
    return [
      ...base,
      ...(await constats(userId, siteId, 'cro')),
      ...(await pages(userId, siteId, 'conversion')),
      conversion ??
        'AUCUNE DONNÉE DE VENTE : Evoliia n’est reliée à aucune source de conversion — ni' +
          ' panier, ni chiffre d’affaires, ni taux d’abandon, ni parcours d’achat. Tu ne' +
          ' disposes que de ce que les pages montrent. Ne cite aucun taux de conversion,' +
          ' aucun chiffre de vente, aucune estimation de gain, et dis-le quand la question en' +
          ' demande.',
    ].join('\n')
  }
  /*
   * Naya voit la publicité, et pour l'instant elle ne voit rien du tout : la connexion
   * Google Ads n'existe pas encore. On le lui dit explicitement plutôt que de lui envoyer
   * un contexte muet — un modèle à qui l'on ne dit rien suppose, et une supposition sur un
   * budget publicitaire se paie tout de suite.
   *
   * Elle garde le socle : le site, ses pages, ce que les gens y cherchent. C'est déjà
   * quelque chose — quelqu'un qui paie pour des mots où il sort déjà premier paie pour ce
   * qu'il a déjà, et c'est une conversation qu'elle peut tenir dès aujourd'hui.
   */
  if (agent === 'ads') {
    /*
     * Le contexte publicitaire est cherché à part parce qu'il peut être absent, et que
     * l'absence doit s'écrire. Un compte non relié n'est pas un compte à zéro : le premier
     * appelle « reliez votre compte », le second appelle « vos campagnes ne tournent plus ».
     * Les confondre ferait dire à Naya que la publicité ne rapporte rien à quelqu'un qui n'en
     * a jamais fait.
     */
    const publicite = await contextePublicitaire(userId)
    return [
      ...base,
      ...(await recherches(userId, siteId)),
      publicite ??
        'DONNÉES PUBLICITAIRES : aucune. Aucun compte Google Ads n’est relié. Tu ne disposes' +
          ' d’aucune dépense, d’aucun ROAS, d’aucune conversion et d’aucune campagne : ne cite' +
          ' aucun chiffre publicitaire, et dis-le quand la question en demande.',
    ].join('\n')
  }
  /*
   * MIRA voit Meta, et rien de Google : les deux agents ont des comptes différents, des
   * chiffres différents et des gestes différents. Lui donner les deux ferait un généraliste
   * qui conseille la moyenne de deux métiers, c'est-à-dire le mauvais conseil deux fois.
   *
   * Elle garde le socle du site et ce que les gens y cherchent : une publicité qui renvoie
   * vers une page qui ne convertit pas est un problème de publicité, et elle doit pouvoir le
   * voir.
   */
  if (agent === 'meta') {
    /*
     * Même distinction que pour Naya, et pour la même raison : un compte non relié n'est pas
     * un compte à zéro. Le premier appelle « reliez votre compte », le second « vos campagnes
     * ne tournent plus ». Les confondre ferait dire à MIRA que la publicité ne rapporte rien
     * à quelqu'un qui n'en a jamais fait.
     */
    const publicite = await contexteMeta(userId)
    return [
      ...base,
      publicite ??
        'DONNÉES META : aucune. Aucun compte Meta Ads n’est relié. Tu ne disposes d’aucune' +
          ' dépense, d’aucun ROAS, d’aucune vente et d’aucune campagne : ne cite aucun chiffre' +
          ' publicitaire, et dis-le quand la question en demande.',
    ].join('\n')
  }
  /*
   * Nova voit les chiffres, et rien des pages : ventes, dépenses, déclarations des régies,
   * clics Google. Tous calculés avant de lui arriver ; elle les explique. Trente jours,
   * parce que c'est la période qui répond à la plupart des questions — « cette semaine »
   * se lit dans les variations, et une autre période se choisit sur son écran.
   */
  if (agent === 'nova') {
    const vue = await lireNova(userId, 'fr', { periode: '30', siteId })
    return [...base, ...faitsNova(vue)].join('\n')
  }
  /*
   * Lina voit la base clients en segments et en totaux, jamais une fiche : ce qu'il faut pour
   * conseiller, rien qui permette de reconnaître quelqu'un.
   */
  if (agent === 'lina') {
    const vue = await lireLina(userId)
    return [...base, ...faitsLina(vue)].join('\n')
  }
  /*
   * Milo écrit. Il voit les deux catalogues — un texte sert au référencement comme aux
   * assistants — mais il voit surtout le texte lui-même, ce que les autres n'ont pas.
   */
  const nova = await contenusPourMilo(userId)
  return [
    ...base,
    ...(await constats(userId, siteId, null)),
    ...(await pages(userId, siteId, 'texte')),
    ...(await recherches(userId, siteId)),
    ...(nova === null ? [] : [nova]),
  ].join('\n')
}

/**
 * Ce que les collègues ont retenu, pour que l'équipe en soit une.
 *
 * Une phrase par échange, celle que chacun a jugée utile aux autres. Sans cela, quatre
 * spécialistes qui ne se parlent pas répètent les mêmes questions à la personne, et c'est
 * elle qui fait le lien — c'est-à-dire le travail qu'on lui promet d'éviter.
 */
export async function siteMemory(
  userId: string,
  siteId: string,
  sauf: VisibilityAgentId,
): Promise<string | null> {
  const notes = await withUserScope(userId, (tx) =>
    tx.visibilityNote.findMany({
      where: { siteId, userId, agent: { not: sauf }, takeaway: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { agent: true, takeaway: true },
    }),
  )
  if (notes.length === 0) return null
  return notes.map((note) => `- ${note.agent} : ${note.takeaway}`).join('\n')
}
