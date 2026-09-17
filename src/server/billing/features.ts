import { AppError } from '@/lib/errors'

/**
 * Droits par abonnement.
 *
 * Une seule couche décide de ce qu'une offre ouvre. Ailleurs dans le code, on ne demande
 * jamais « quel est le plan de cette personne » mais « cette fonction lui est-elle
 * ouverte ». C'est ce qui permet de déplacer une fonction d'une offre à l'autre depuis le
 * back-office sans toucher une ligne, et d'éviter la dispersion de conditions
 * `plan === 'business'` qui rendent une grille tarifaire impossible à faire évoluer.
 *
 * Deux notions à ne pas confondre :
 *   - `status: 'live'`   la fonction existe. Elle peut être ouverte, ou verrouillée avec
 *                        la promesse tenable « disponible avec telle offre ».
 *   - `status: 'prevu'`  la fonction n'existe pas encore. Elle figure ici pour la feuille
 *                        de route et le back-office, mais aucune grille tarifaire et aucun
 *                        message d'incitation ne doit la présenter comme achetable.
 */

export type FeatureStatus = 'live' | 'prevu'

export type FeatureGroup = 'social' | 'equipe' | 'radar' | 'support'

export type Feature = {
  id: string
  group: FeatureGroup
  /** Nom lisible, tel qu'il apparaît dans une grille tarifaire. */
  label: string
  /** Ce que la fonction fait, en une phrase, pour quelqu'un qui ne connaît pas le produit. */
  summary: string
  status: FeatureStatus
}

export const FEATURES: readonly Feature[] = [
  {
    id: 'social_launch_basic',
    group: 'social',
    label: 'Kit de lancement',
    summary:
      'À partir de votre projet : vos bénéfices, trois angles marketing, sept idées de publications et le calendrier de votre première semaine.',
    status: 'live',
  },
  {
    id: 'social_angles',
    group: 'social',
    label: 'Angles marketing',
    summary:
      'Plusieurs façons de présenter votre application. Vous gardez celles qui vous ressemblent, vous écartez les autres.',
    status: 'live',
  },
  {
    id: 'social_week',
    group: 'social',
    label: 'Calendrier d’une semaine',
    summary: 'Sept jours de publications datées, prêtes à relire.',
    status: 'live',
  },
  {
    id: 'social_calendar',
    group: 'social',
    label: 'Calendrier mensuel',
    summary:
      'Quatre semaines qui progressent — se faire connaître, prouver, lever les objections, inviter — à partir des angles que vous avez retenus.',
    status: 'live',
  },
  {
    id: 'social_content_generation',
    group: 'social',
    label: 'Génération de contenus',
    summary:
      'Chaque publication se réécrit, se raccourcit, se développe, change de ton ou s’adapte à un autre réseau. Vous choisissez la version qui vous ressemble.',
    status: 'live',
  },
  {
    id: 'social_agent',
    group: 'equipe',
    label: 'Tom — Social Media Manager',
    summary: 'Un interlocuteur qui prépare vos semaines et garde le fil de ce qui a déjà été publié.',
    status: 'live',
  },
  {
    id: 'social_analytics_basic',
    group: 'social',
    label: 'Résultats de vos publications',
    summary: 'Ce que vos publications obtiennent réellement, quand les réseaux le communiquent.',
    status: 'prevu',
  },
  {
    id: 'marketing_team',
    group: 'equipe',
    label: 'Équipe marketing',
    summary: 'Une coordination entre les différents métiers du marketing.',
    status: 'live',
  },
  {
    id: 'seo_agent',
    group: 'equipe',
    label: 'Noah — Référencement',
    summary: 'Le travail de visibilité sur les moteurs de recherche.',
    status: 'live',
  },
  /*
   * Deux modules à part entière. Ils ne sont ajoutés à aucune offre ici : c'est
   * l'exploitant qui décide, depuis le back-office, et les quotas mensuels qui les bornent
   * se règlent au même endroit.
   */
  {
    id: 'radar',
    group: 'radar',
    label: 'Radar d’opportunités',
    summary:
      'Des opportunités adaptées à votre profil, expliquées, comparables et enregistrables. Chaque recherche est bornée par un quota mensuel.',
    status: 'live',
  },
  {
    id: 'lia_support',
    group: 'support',
    label: 'Lia — Support client',
    summary:
      'Une assistante dans vos applications, qui répond depuis votre base de connaissances, dit quand elle ne sait pas, et transmet le reste en ticket.',
    status: 'live',
  },
  {
    id: 'analytics_agent',
    group: 'equipe',
    label: 'Mila — Analyse',
    summary: 'La lecture des résultats et les recommandations qui en découlent.',
    status: 'live',
  },
  /*
   * L'équipe de visibilité. Annoncée, pas encore construite — d'où « prevu », qui n'est pas
   * un détail d'affichage : une fonction prévue n'entre jamais dans les droits accordés,
   * donc personne ne peut l'atteindre par mégarde, et aucune offre ne la vend. Chacune
   * passera à « live » le jour où elle marchera, et pas un jour avant.
   */
  {
    id: 'visibility_audit_agent',
    group: 'equipe',
    label: 'Léa — Audit de visibilité',
    summary:
      'L’analyse de votre site page par page : ce qui cloche, classé par ordre d’importance.',
    status: 'live',
  },
  {
    id: 'visibility_seo_agent',
    group: 'equipe',
    label: 'Néo — Référencement',
    summary: 'Les titres, les descriptions, la structure et les liens entre vos pages.',
    status: 'live',
  },
  {
    id: 'visibility_geo_agent',
    group: 'equipe',
    label: 'Gia — Moteurs IA',
    summary:
      'Ce qu’une intelligence artificielle comprend de vos pages, et ce qui l’en empêche.',
    status: 'live',
  },
  {
    id: 'visibility_content_agent',
    group: 'equipe',
    label: 'Milo — Contenu',
    summary: 'L’écriture et la réécriture : descriptions, pages, questions fréquentes, articles.',
    status: 'live',
  },
]

export const FEATURE_IDS = FEATURES.map((feature) => feature.id)

/**
 * Kit de lancement. Nommé ici plutôt que dans le service qui l'implémente : la grille
 * tarifaire a besoin de savoir quelles offres l'ouvrent, sans charger tout le moteur.
 */
export const LAUNCH_KIT_FEATURE = 'social_launch_basic'

export function findFeature(id: string): Feature | undefined {
  return FEATURES.find((feature) => feature.id === id)
}

/** Fonctions réellement construites : les seules qui peuvent être promises. */
export function liveFeatures(): Feature[] {
  return FEATURES.filter((feature) => feature.status === 'live')
}

/**
 * Répartition de départ, écrite une fois en base par migration.
 *
 * Ce n'est pas la source de vérité : la colonne `Plan.features` l'est, et le back-office la
 * modifie. Ces valeurs servent à initialiser une installation neuve et à documenter
 * l'intention commerciale.
 */
/**
 * Ce que chaque offre ouvre, par identifiant.
 *
 * Les quatre spécialistes y figurent dès l'offre d'entrée, et ce n'est pas une largesse :
 * une équipe dont on ne voit qu'un membre n'est pas une équipe, et l'écart entre les offres
 * se joue sur ce qu'on peut leur demander — les crédits, les sites, les pages — pas sur le
 * droit de leur parler. Ils sont d'ailleurs déclarés « prévu » tant qu'ils ne fonctionnent
 * pas, et une fonction prévue n'entre jamais dans les droits accordés : les nommer ici ne
 * les ouvre donc pas avant l'heure.
 *
 * L'essai n'ouvre rien : il montre l'audit et ses notes, et s'arrête là où il faudrait
 * dépenser pour Evoliia.
 */
export const DEFAULT_PLAN_FEATURES: Record<string, readonly string[]> = {
  'vis-essai': [],
  'vis-starter': [
    'visibility_audit_agent',
    'visibility_seo_agent',
    'visibility_geo_agent',
    'visibility_content_agent',
  ],
  'vis-pro': [
    'visibility_audit_agent',
    'visibility_seo_agent',
    'visibility_geo_agent',
    'visibility_content_agent',
  ],
  'vis-business': [
    'visibility_audit_agent',
    'visibility_seo_agent',
    'visibility_geo_agent',
    'visibility_content_agent',
  ],
}

export type Entitlements = {
  planId: string
  planName: string
  /** Fonctions ouvertes ET construites. Une fonction prévue n'y figure jamais. */
  granted: string[]
  /** Fonctions construites que cette offre n'ouvre pas, avec l'offre qui les ouvre. */
  locked: Array<{ feature: Feature; availableWith: string | null }>
}

/**
 * Résout les droits d'une personne.
 *
 * Une fonction seulement prévue est retirée des droits même si une offre la contient :
 * facturer l'accès à quelque chose qui n'existe pas serait une promesse non tenue, et le
 * back-office peut cocher une case plus vite que le produit ne se construit.
 */
export function resolveEntitlements(
  plan: { id: string; name: string; features: string[] },
  plans: Array<{ id: string; name: string; features: string[]; sortOrder: number }>,
): Entitlements {
  const granted = plan.features.filter((id) => findFeature(id)?.status === 'live')

  const ordered = [...plans].sort((a, b) => a.sortOrder - b.sortOrder)
  const locked = liveFeatures()
    .filter((feature) => !granted.includes(feature.id))
    .map((feature) => ({
      feature,
      availableWith:
        ordered.find((candidate) => candidate.features.includes(feature.id))?.name ?? null,
    }))

  return { planId: plan.id, planName: plan.name, granted, locked }
}

export function requireFeature(entitlements: Entitlements, featureId: string): void {
  if (entitlements.granted.includes(featureId)) return

  const feature = findFeature(featureId)
  const locked = entitlements.locked.find((entry) => entry.feature.id === featureId)

  if (feature === undefined || feature.status === 'prevu') {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      "Cette fonction n'existe pas encore. Elle arrivera dans une prochaine version.",
    )
  }
  throw new AppError(
    'PLAN_LIMIT',
    locked?.availableWith == null
      ? `« ${feature.label} » n'est pas incluse dans votre offre.`
      : `« ${feature.label} » est disponible avec l'offre ${locked.availableWith}.`,
  )
}
