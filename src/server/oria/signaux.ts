import { compteActif } from '@/server/ads/comptes'
import { lireRecommandations } from '@/server/ads/recommandations'
import { lireRecommandationsMeta } from '@/server/ads/recommandations-meta'
import { readPlan, type LignePlan } from '@/server/audit/plan'
import { readDashboard } from '@/server/audit/service'
import { listWatches } from '@/server/audit/surveillance'
import { withUserScope } from '@/server/db/scope'
import { readSetting } from '@/server/settings/store'
import { santeMarketing, type Canal } from './sante'
import type { VisibilityAgentId } from '@/server/agents/visibility'

/**
 * Ce qu'Oria lit, et ce qu'elle en fait.
 *
 * C'est le cœur du personnage, et il n'est pas conversationnel. Oria ne refait aucune
 * analyse : Léa a déjà exploré le site, Néo, Gia et Cleo ont déjà rendu leurs constats,
 * Naya et MIRA ont déjà appliqué leurs règles. Tout cela existe, calculé, en base. Le
 * problème n'a jamais été de produire des analyses — c'est d'en avoir vingt-sept et de ne
 * pas savoir laquelle traiter lundi matin.
 *
 * Ce module fait donc une seule chose : il ramène des constats de formes différentes à une
 * forme commune, et les classe. Quatre décisions le gouvernent.
 *
 * **Rien n'est produit ici.** Pas un chiffre, pas une phrase qui ne vienne d'un constat
 * déjà enregistré. Un signal porte le titre, l'explication et l'adresse que son agent lui a
 * donnés. Oria ne les réécrit pas : elle les met dans le bon ordre, ce qui est un autre
 * métier et le seul qu'elle exerce ici.
 *
 * **Le classement est du calcul, jamais un modèle.** `impact × confiance × urgence ÷
 * effort`, avec des poids lisibles et réglables. Demander à une intelligence artificielle
 * quelle est la priorité rendrait un ordre différent à chaque rafraîchissement, impossible
 * à expliquer et impossible à corriger. Ici, on peut refaire le calcul à la main et
 * répondre à « pourquoi celle-là d'abord ».
 *
 * **Chaque source peut manquer sans emporter les autres.** Un compte publicitaire délié, un
 * site jamais analysé, une lecture qui échoue : le cockpit doit rester debout et dire ce
 * qui manque. Chaque lecture est donc isolée, et une erreur rend une liste vide plutôt que
 * de faire tomber l'écran.
 *
 * **Ce qui n'est pas mesuré n'est pas affirmé.** La confiance accompagne chaque signal et
 * vient de la quantité de données derrière lui — jours relevés, pages lues. Un constat
 * ouvert sur trois jours de dépense ne vaut pas un constat ouvert sur trente, et l'écran
 * doit pouvoir le dire au lieu de les aligner.
 */

/** L'échelle commune de l'impact et de l'effort. Trois crans : au-delà, personne ne tranche. */
export const AMPLEURS = ['faible', 'moyen', 'eleve'] as const

export type Ampleur = (typeof AMPLEURS)[number]

/**
 * À quelle vitesse la chose coûte.
 *
 * `critique` est réservé à ce qui coûte **maintenant** : un site qui ne répond plus, un
 * budget qui part sans vente. Une balise absente coûte aussi, mais lentement, et la ranger
 * au même niveau ferait de « critique » un mot sans effet.
 */
export const URGENCES = ['critique', 'important', 'information'] as const

export type Urgence = (typeof URGENCES)[number]

/** Ce que les données derrière un signal permettent d'affirmer. */
export const CONFIANCES = ['faible', 'moyenne', 'elevee'] as const

export type Confiance = (typeof CONFIANCES)[number]

export type Signal = {
  /**
   * Identifiant stable d'un passage à l'autre.
   *
   * Il sert à reconnaître un signal déjà vu : c'est lui qui permettra à Oria de ne pas
   * reproposer chaque jour ce qui a été écarté trois fois. Il est composé de la source et
   * de la référence du constat chez elle, jamais d'un rang ni d'une date.
   */
  cle: string
  /** Les agents dont ce signal vient. Plusieurs quand il naît d'un rapprochement. */
  sources: readonly VisibilityAgentId[]
  titre: string
  /** Pourquoi ça compte, dans les mots de l'agent qui l'a relevé. */
  pourquoi: string
  /** Ce qu'il y a à faire, et par qui. */
  quoiFaire: string
  /**
   * Sur quoi ce signal repose, en une phrase.
   *
   * C'est la réponse au « Pourquoi ? » que l'écran doit toujours offrir : les données
   * utilisées et leurs limites. Sans elle, une priorité se lit comme un oracle.
   */
  mesure: string
  impact: Ampleur
  effort: Ampleur
  urgence: Urgence
  confiance: Confiance
  /** L'écran du spécialiste, pour aller voir. Oria oriente, elle ne retient pas. */
  href: string
}

/**
 * Les poids du classement.
 *
 * Réglables depuis l'administration parce qu'ils encodent un arbitrage — combien un
 * critique vaut d'informations — et qu'un arbitrage n'a pas à passer par un déploiement.
 * Ce sont des multiplicateurs, pas des points : seuls leurs rapports comptent.
 */
export type PoidsOria = {
  impact: Record<Ampleur, number>
  effort: Record<Ampleur, number>
  urgence: Record<Urgence, number>
  confiance: Record<Confiance, number>
}

export const POIDS_DEFAUT: PoidsOria = {
  impact: { faible: 1, moyen: 2, eleve: 4 },
  /*
   * L'effort divise. Un gros effort n'annule donc jamais un gros impact — il le retarde,
   * ce qui est la bonne façon de traiter « refaire la page d'accueil » : ça reste à faire,
   * mais après les trois choses qui se règlent dans l'heure.
   */
  effort: { faible: 1, moyen: 2, eleve: 3 },
  urgence: { information: 1, important: 2, critique: 4 },
  confiance: { faible: 0.5, moyenne: 1, elevee: 1.5 },
}

/** Clé de réglage : les poids d'Oria, en JSON. */
export const POIDS_SETTING = 'oria.poids'

/**
 * Les poids en vigueur.
 *
 * Une saisie fautive dans le back-office ne doit pas faire disparaître les priorités : on
 * retombe alors sur ceux du code, cran par cran, plutôt que sur rien.
 */
export async function poidsOria(): Promise<PoidsOria> {
  const brut = await readSetting(POIDS_SETTING).catch(() => null)
  if (brut === null || brut.trim() === '') return POIDS_DEFAUT
  try {
    const lu: unknown = JSON.parse(brut)
    if (lu === null || typeof lu !== 'object' || Array.isArray(lu)) return POIDS_DEFAUT
    const table = lu as Record<string, unknown>
    const fondre = <T extends string>(
      nom: string,
      defaut: Record<T, number>,
    ): Record<T, number> => {
      const remplacant = table[nom]
      if (remplacant === null || typeof remplacant !== 'object') return defaut
      const sortie = { ...defaut }
      for (const [cran, valeur] of Object.entries(remplacant as Record<string, unknown>)) {
        if (!(cran in sortie)) continue
        const nombre = Number(valeur)
        // Un poids nul ou négatif retirerait un cran du classement sans le dire.
        if (Number.isFinite(nombre) && nombre > 0) sortie[cran as T] = nombre
      }
      return sortie
    }
    return {
      impact: fondre('impact', POIDS_DEFAUT.impact),
      effort: fondre('effort', POIDS_DEFAUT.effort),
      urgence: fondre('urgence', POIDS_DEFAUT.urgence),
      confiance: fondre('confiance', POIDS_DEFAUT.confiance),
    }
  } catch {
    return POIDS_DEFAUT
  }
}

/**
 * Le score d'un signal.
 *
 * `impact × confiance × urgence ÷ effort`. Il n'a pas à s'afficher : un nombre sans unité
 * n'aide personne à décider, et le montrer inviterait à le discuter au lieu de discuter du
 * constat. Il sert à ordonner, et l'écran montre les quatre critères qui l'ont produit —
 * ceux-là, on peut en parler.
 *
 * `biais` est le poids que l'objectif de l'entreprise donne à chaque agent : quelqu'un qui
 * cherche des leads ne classe pas comme quelqu'un qui cherche du trafic. Neutre par défaut.
 */
export function scoreOria(
  signal: Signal,
  poids: PoidsOria,
  biais: Partial<Record<VisibilityAgentId, number>> = {},
): number {
  const faveur = Math.max(...signal.sources.map((source) => biais[source] ?? 1), 1)
  return (
    (poids.impact[signal.impact] *
      poids.confiance[signal.confiance] *
      poids.urgence[signal.urgence] *
      faveur) /
    poids.effort[signal.effort]
  )
}

/** Classe des signaux, du plus pressant au moins. */
export function classer(
  signaux: readonly Signal[],
  poids: PoidsOria,
  biais: Partial<Record<VisibilityAgentId, number>> = {},
): Signal[] {
  return [...signaux].sort(
    (a, b) => scoreOria(b, poids, biais) - scoreOria(a, poids, biais) || a.cle.localeCompare(b.cle),
  )
}

/** Une lecture qui ne peut pas faire tomber le cockpit. */
async function sans<T>(lecture: Promise<T>, defaut: T): Promise<T> {
  return lecture.catch(() => defaut)
}

// ── Ce que chaque agent remonte ──────────────────────────────────────────────

/** Où va le lecteur pour approfondir, selon le moteur du constat. */
function ecranDuMoteur(locale: string, moteur: string, siteId: string): string {
  const site = `?siteId=${siteId}`
  if (moteur === 'cro') return `/${locale}/visibilite/conversion${site}`
  if (moteur === 'geo') return `/${locale}/visibilite/assistants${site}`
  return `/${locale}/visibilite${site}`
}

const AGENT_DU_MOTEUR: Record<string, VisibilityAgentId> = {
  seo: 'seo',
  geo: 'geo',
  cro: 'cro',
}

/**
 * Les constats d'audit encore à traiter.
 *
 * `lost` est le nombre de points que le constat coûte à sa note : il tient déjà compte de
 * l'étendue — le même défaut sur quarante pages coûte plus que sur une. C'est donc la
 * meilleure mesure d'impact disponible, et elle est calculée, pas estimée.
 *
 * La gravité, elle, donne l'urgence, et pas l'inverse : un titre absent est grave et lent,
 * un site qui ne répond plus est grave et immédiat. Les confondre viderait « critique » de
 * son sens, et c'est le mot qui doit faire lever quelqu'un de sa chaise.
 */
function depuisPlan(lignes: readonly LignePlan[], locale: string, siteId: string): Signal[] {
  return lignes
    .filter((ligne) => ligne.state === 'todo' || ligne.state === 'doing')
    .filter((ligne) => AGENT_DU_MOTEUR[ligne.engine] !== undefined)
    .map((ligne) => {
      const agent = AGENT_DU_MOTEUR[ligne.engine] as VisibilityAgentId
      const etendue =
        ligne.scope === 'site'
          ? 'sur le site entier'
          : `sur ${ligne.affected} page${ligne.affected > 1 ? 's' : ''} analysée${ligne.affected > 1 ? 's' : ''} sur ${ligne.examined}`
      return {
        cle: `plan:${ligne.checkId}`,
        sources: [agent],
        titre: ligne.label,
        pourquoi: ligne.why,
        quoiFaire:
          ligne.corrigeable
            ? 'L’équipe sait rédiger cette correction : ouvrez le constat et relisez ce qu’elle propose.'
            : 'Ouvrez le constat pour voir les pages concernées.',
        mesure: `Relevé par l’analyse du site, ${etendue}.`,
        impact: ligne.lost >= 8 ? 'eleve' : ligne.lost >= 4 ? 'moyen' : 'faible',
        effort: ligne.rapide ? 'faible' : ligne.severity === 'critical' ? 'eleve' : 'moyen',
        urgence: ligne.severity === 'improvement' ? 'information' : 'important',
        // Un contrôle est du calcul sur des pages réellement lues : rien n'est plus sûr ici.
        confiance: 'elevee',
        href: ecranDuMoteur(locale, ligne.engine, siteId),
      } satisfies Signal
    })
}

/**
 * Ce que la surveillance trouve cassé.
 *
 * Seule famille de signaux à mériter `critique` du côté du site : ce sont des pannes — plus
 * de réponse, une désindexation demandée — qui effacent tout le reste et ne se voient pas
 * depuis son propre navigateur, où le site continue de s'afficher.
 */
function depuisSurveillance(
  constats: readonly { checkId: string; label: string; why: string; url: string; detail: string }[],
  locale: string,
  siteId: string,
): Signal[] {
  return constats.map((constat) => ({
    cle: `panne:${constat.checkId}:${constat.url}`,
    sources: ['audit'],
    titre: constat.label,
    pourquoi: constat.why,
    quoiFaire: 'À corriger sur le site. Rien d’autre ne compte tant que ça dure.',
    mesure:
      constat.detail === ''
        ? `Constaté par la surveillance sur ${constat.url}.`
        : `Constaté par la surveillance sur ${constat.url} : ${constat.detail}.`,
    impact: 'eleve',
    effort: 'moyen',
    urgence: 'critique',
    confiance: 'elevee',
    href: `/${locale}/visibilite?siteId=${siteId}`,
  }))
}

const URGENCE_PUBLICITAIRE: Record<string, Urgence> = {
  urgent: 'critique',
  opportunite: 'important',
  surveiller: 'important',
  information: 'information',
}

const IMPACT_PUBLICITAIRE: Record<string, Ampleur> = {
  urgent: 'eleve',
  opportunite: 'eleve',
  surveiller: 'moyen',
  information: 'faible',
}

/**
 * La confiance d'un constat publicitaire, tirée de sa fenêtre de lecture.
 *
 * C'est exactement ce que le produit doit savoir dire : un ROAS lu sur trois jours et un
 * ROAS lu sur trente ne se valent pas, et les afficher côte à côte sans le dire reviendrait
 * à traiter le bruit comme une tendance.
 */
function confianceDesJours(jours: number): Confiance {
  if (jours >= 14) return 'elevee'
  if (jours >= 7) return 'moyenne'
  return 'faible'
}

/**
 * Un constat publicitaire, de Naya ou de MIRA, ramené à la forme commune.
 *
 * Les deux règles ne décrivent pas leurs constats de la même façon — Google s'en tient à
 * une observation et une explication, Meta détaille la conséquence et la recommandation.
 * L'appelant fait cette traduction, qui lui appartient, et ne passe ici que ce que les deux
 * ont en commun.
 *
 * L'effort vient de ce que la règle a préparé : un constat qui porte une action toute
 * montée se règle en un clic et une validation ; un constat qui n'en porte pas demande du
 * travail — écrire des annonces, produire des visuels. C'est une donnée, pas une
 * appréciation, et c'est ce qui la rend défendable.
 */
type ConstatPublicitaire = {
  id: string
  titre: string
  priorite: string
  jours: number
  /** Ce que la règle propose d'envoyer à la plateforme. Vide : rien n'est prêt. */
  action: Record<string, unknown>
  pourquoi: string
  quoiFaire: string
}

function depuisPublicite(
  constats: readonly ConstatPublicitaire[],
  agent: VisibilityAgentId,
  href: string,
  nomPlateforme: string,
): Signal[] {
  return constats.map((constat) => ({
    cle: `${agent}:${constat.id}`,
    sources: [agent],
    titre: constat.titre,
    pourquoi: constat.pourquoi,
    quoiFaire: constat.quoiFaire,
    mesure: `${nomPlateforme}, sur ${constat.jours} jour${constat.jours > 1 ? 's' : ''} de données.`,
    impact: IMPACT_PUBLICITAIRE[constat.priorite] ?? 'faible',
    effort: Object.keys(constat.action).length > 0 ? 'faible' : 'moyen',
    urgence: URGENCE_PUBLICITAIRE[constat.priorite] ?? 'information',
    confiance: confianceDesJours(constat.jours),
    href,
  }))
}

// ── Le rapprochement, qui est le métier propre d'Oria ────────────────────────

/**
 * En deçà, un site donne peu de raisons de décider à qui arrive dessus.
 *
 * Soixante-dix n'est pas un seuil scientifique : c'est le cran à partir duquel plusieurs
 * contrôles de Cleo ont échoué à la fois. Il vit ici, nommé, plutôt que dispersé dans une
 * condition.
 */
const CONVERSION_FAIBLE = 70

/** En deçà, la dépense est trop faible pour qu'on en tire quoi que ce soit. */
const DEPENSE_MINIMALE = 50

const JOURS_DEPENSE = 30

/**
 * Ce que dépensent les campagnes, lu sur les relevés déjà en base.
 *
 * Aucun appel aux plateformes : Naya et MIRA les ont déjà interrogées, et redemander
 * coûterait un appel d'API pour un chiffre qu'on a. Seules les lignes de campagne sont
 * comptées — Meta relève aussi par ensemble et par annonce, et tout additionner compterait
 * la même dépense trois fois.
 */
async function depenseRecente(userId: string, accountId: string): Promise<number> {
  const depuis = new Date(Date.now() - JOURS_DEPENSE * 24 * 60 * 60 * 1000)
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsReleve.findMany({
      where: { userId, accountId, groupeId: '', annonceId: '', jour: { gte: depuis } },
      select: { coutMicros: true },
    }),
  )
  return lignes.reduce((total, ligne) => total + Number(ligne.coutMicros) / 1_000_000, 0)
}

/**
 * Le seul signal qu'aucun agent ne peut produire seul.
 *
 * Naya voit la dépense et les clics ; elle ne sait pas ce qu'il y a au bout. Cleo voit ce
 * qui manque aux pages pour qu'on y décide ; elle ne sait pas qu'on paie pour y envoyer du
 * monde. Ensemble, les deux disent quelque chose qu'aucune ne dit : on achète du trafic
 * vers un site qui donne peu de raisons d'acheter, et augmenter le budget avant d'y
 * remédier revient à remplir un seau percé.
 *
 * Ce qu'il ne dit pas, et qui est écrit dans `mesure` : Evoliia ne connaît pas encore les
 * pages d'arrivée des campagnes. Le rapprochement vaut donc pour le site, pas pour une page
 * précise — et la confiance s'en tient là. Annoncer « votre landing page convertit mal »
 * serait dire une chose qu'on ne sait pas, sur le ton d'une mesure.
 */
function croisementPayantConversion(
  depenses: readonly { agent: VisibilityAgentId; montant: number; devise: string }[],
  croScore: number | null,
  locale: string,
  siteId: string,
): Signal[] {
  if (croScore === null || croScore >= CONVERSION_FAIBLE) return []
  const actives = depenses.filter((une) => une.montant >= DEPENSE_MINIMALE)
  if (actives.length === 0) return []

  const total = actives.reduce((somme, une) => somme + une.montant, 0)
  const devise = actives[0]?.devise ?? ''
  const sources: VisibilityAgentId[] = ['cro', ...actives.map((une) => une.agent)]

  return [
    {
      cle: 'croisement:payant-conversion',
      sources,
      titre: 'Vous payez pour du trafic qui arrive sur un site peu convaincant',
      pourquoi:
        'Vos campagnes achètent des visiteurs, et vos pages leur donnent peu de raisons de décider : promesse, bouton, réassurance, prix. Augmenter le budget avant d’y remédier revient à payer plus cher le même départ.',
      quoiFaire:
        'Traitez d’abord les priorités de Cleo, puis revenez aux budgets. L’ordre compte : ce qu’on corrige sur les pages profite à toutes les campagnes, présentes et futures.',
      mesure: `${Math.round(total)} ${devise} dépensés sur ${JOURS_DEPENSE} jours, pour une note de conversion de ${croScore}/100. Evoliia ne connaît pas encore les pages d’arrivée de vos campagnes : ce rapprochement porte sur le site, pas sur une page précise.`,
      impact: 'eleve',
      effort: 'moyen',
      urgence: 'important',
      /*
       * Moyenne, et pas élevée. Les deux mesures sont sûres chacune de son côté ; c'est
       * leur rapprochement qui suppose que le trafic payant arrive sur les pages analysées.
       * C'est vraisemblable et ce n'est pas établi, et la différence doit se voir.
       */
      confiance: 'moyenne',
      href: `/${locale}/visibilite/conversion?siteId=${siteId}`,
    },
  ]
}

// ── La lecture complète ──────────────────────────────────────────────────────

export type Consolidation = {
  signaux: Signal[]
  /** L'état de chaque canal, jugé sur les mêmes lectures. Aucune requête de plus. */
  canaux: Canal[]
  /** Les agents dont une donnée a réellement été lue. Sert à dire ce qui manque. */
  sourcesLues: VisibilityAgentId[]
  /** Le site regardé, quand il y en a un d'analysé. */
  site: { id: string; host: string } | null
  /** Les trois notes du dernier audit, pour l'en-tête du cockpit. */
  notes: { seo: number | null; geo: number | null; cro: number | null }
}

/**
 * Tout ce qu'Oria sait, en un passage.
 *
 * Les lectures sont lancées ensemble parce qu'elles ne dépendent pas les unes des autres,
 * et chacune est isolée : un compte publicitaire délié ou une analyse jamais lancée rend
 * une liste vide, pas une page en erreur. `sourcesLues` dit ensuite de qui l'on a
 * réellement des nouvelles, ce qui est la seule façon honnête d'écrire « je ne peux pas
 * encore analyser votre rentabilité Meta » plutôt que de laisser un silence.
 */
export async function lireSignaux(
  userId: string,
  locale: string,
  siteId?: string,
): Promise<Consolidation> {
  const tableau = await sans(readDashboard(userId, siteId), null)
  const site = tableau === null ? null : { id: tableau.site.id, host: tableau.site.host }

  const [plan, pannes, compteAds, compteMeta] = await Promise.all([
    site === null ? Promise.resolve(null) : sans(readPlan(userId, site.id), null),
    site === null ? Promise.resolve([]) : sans(listWatches(userId, site.id), []),
    sans(compteActif(userId, 'google-ads'), null),
    sans(compteActif(userId, 'meta-ads'), null),
  ])

  const [recosAds, recosMeta, depenseAds, depenseMeta] = await Promise.all([
    compteAds === null ? Promise.resolve([]) : sans(lireRecommandations(userId, compteAds.id), []),
    compteMeta === null
      ? Promise.resolve([])
      : sans(lireRecommandationsMeta(userId, compteMeta.id), []),
    compteAds === null ? Promise.resolve(0) : sans(depenseRecente(userId, compteAds.id), 0),
    compteMeta === null ? Promise.resolve(0) : sans(depenseRecente(userId, compteMeta.id), 0),
  ])

  const sourcesLues: VisibilityAgentId[] = []
  if (site !== null) sourcesLues.push('audit', 'seo', 'geo', 'cro')
  if (compteAds !== null) sourcesLues.push('ads')
  if (compteMeta !== null) sourcesLues.push('meta')

  const signaux: Signal[] = [
    ...(site === null ? [] : depuisSurveillance(pannes, locale, site.id)),
    ...(site === null || plan === null ? [] : depuisPlan(plan.lignes, locale, site.id)),
    ...depuisPublicite(
      recosAds.map((reco) => ({
        ...reco,
        pourquoi: reco.observation,
        quoiFaire: reco.explication,
      })),
      'ads',
      `/${locale}/publicite`,
      'Google Ads',
    ),
    ...depuisPublicite(
      /*
       * MIRA distingue la conséquence de l'observation : « votre coût par vente a doublé »
       * dit ce qui se passe, là où l'observation donne les chiffres. C'est la conséquence
       * qu'on lit en premier dans une liste de priorités, et l'observation qui attend sur
       * son écran.
       */
      recosMeta.map((reco) => ({
        ...reco,
        pourquoi: reco.consequence === '' ? reco.observation : reco.consequence,
        quoiFaire: reco.recommandation,
      })),
      'meta',
      `/${locale}/publicite/meta`,
      'Meta Ads',
    ),
    ...croisementPayantConversion(
      [
        ...(compteAds === null
          ? []
          : [{ agent: 'ads' as const, montant: depenseAds, devise: compteAds.devise }]),
        ...(compteMeta === null
          ? []
          : [{ agent: 'meta' as const, montant: depenseMeta, devise: compteMeta.devise }]),
      ],
      tableau?.audit.croScore ?? null,
      locale,
      site?.id ?? '',
    ),
  ]

  /*
   * La santé se juge sur les lectures déjà faites : rien n'est redemandé à la base. Les
   * comptages par priorité viennent des mêmes listes de constats que les signaux, ce qui
   * garantit qu'un canal ne peut pas s'afficher « bon » pendant qu'une de ses lignes figure
   * dans les priorités.
   */
  const compter = (
    constats: readonly { priorite: string }[],
    cherchee: string,
  ): number => constats.filter((un) => un.priorite === cherchee).length

  const canaux = santeMarketing({
    seoScore: tableau?.audit.seoScore ?? null,
    geoScore: tableau?.audit.geoScore ?? null,
    croScore: tableau?.audit.croScore ?? null,
    siteAnalyse: site !== null,
    pannes: pannes.length,
    ads: {
      relie: compteAds !== null,
      urgents: compter(recosAds, 'urgent'),
      aSurveiller: compter(recosAds, 'surveiller'),
    },
    meta: {
      relie: compteMeta !== null,
      urgents: compter(recosMeta, 'urgent'),
      aSurveiller: compter(recosMeta, 'surveiller'),
    },
  })

  const poids = await poidsOria()
  return {
    signaux: classer(signaux, poids),
    canaux,
    sourcesLues,
    site,
    notes: {
      seo: tableau?.audit.seoScore ?? null,
      geo: tableau?.audit.geoScore ?? null,
      cro: tableau?.audit.croScore ?? null,
    },
  }
}
