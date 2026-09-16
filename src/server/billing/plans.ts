import { prisma } from '@/server/db/client'
import { DEFAULT_PLAN_FEATURES } from './features'

/**
 * Offres de la plateforme.
 *
 * Les valeurs ci-dessous ne sont que les **valeurs initiales** insérées en base au
 * premier démarrage. La vérité est la table `Plan`, modifiable depuis l'administration
 * sans redéploiement (exigence 34).
 */

export type PlanDefaults = {
  id: string
  name: string
  description: string
  priceCents: number
  maxProjects: number
  /**
   * Services externes connectables. Un seul connecteur est ouvert à ce jour, la clé
   * Anthropic du créateur ; le plafond existe pour que l'ouverture des suivants ne se
   * traduise pas par un nombre illimité de comptes reliés à une offre d'entrée.
   */
  maxConnections: number
  /** Fonctions ouvertes, par identifiant. Voir features.ts. */
  features: readonly string[]
  /**
   * Espace d'images autorisé, en octets.
   *
   * C'est la seule dépense de la plateforme qui grandirait avec l'usage et non avec le
   * nombre de clients. La borner par offre est ce qui permet d'annoncer un prix fixe.
   */
  storageBytes: number
  /**
   * Quotas mensuels des deux modules. Une recherche du Radar partout — l'exemple donné pour
   * l'offre gratuite — et rien pour Lia : c'est l'exploitant qui ouvre, depuis le back-office.
   */
  radarRunsPerMonth: number
  liaAnswersPerMonth: number
  liaConversationsPerMonth: number
  /**
   * Alertes par courriel au créateur quand un visiteur saisit une fiche.
   *
   * Zéro partout au départ, y compris sur les offres payantes : l'envoi est à la charge
   * d'Evoliia, et une fonction qui coûte ne s'ouvre pas toute seule. C'est l'exploitant qui
   * décide, offre par offre, depuis le back-office.
   */
  alertsPerMonth: number
  /**
   * Images créées par l'IA sur le compte d'Evoliia.
   *
   * Zéro par défaut, et c'est délibéré : chaque image est une dépense réelle pour la
   * plateforme — environ quatre centimes — là où le reste des quotas ne borne que du calcul
   * déjà payé. La fonction s'ouvre offre par offre depuis le back-office. Le créateur qui
   * connecte sa propre clé n'est pas concerné : sa voie ne coûte rien à Evoliia.
   */
  imagesPerMonth: number
  /**
   * Ce que l'offre accorde dans le produit de visibilité.
   *
   * `auditsPerMonth` borne la seule dépense qui grandit avec l'usage : un audit n'est pas
   * du calcul gratuit, c'est un parcours réel de pages sur le réseau, à la charge
   * d'Evoliia. Les deux autres bornent ce qu'on promet, pas ce qu'on dépense.
   */
  sitesMax: number
  pagesPerAudit: number
  auditsPerMonth: number
  monthlyCredits: number
  /** Monnaie de l'offre. Le franc pour un produit vendu d'abord en Suisse. */
  currency: string
  allowBuild: boolean
  allowExport: boolean
  allowCustomDomain: boolean
  allowMobilePrep: boolean
  isRecommended: boolean
  sortOrder: number
}

/**
 * Valeurs de départ, calées sur le coût réel mesuré (voir docs/09-recentrage.md).
 *
 * L'offre gratuite va volontairement jusqu'au bout de la réflexion — objectif, idées,
 * validation — mais s'arrête avant la construction. C'est là que se situe la décision
 * d'abonnement, au moment où l'utilisateur veut concrétiser une idée qui l'intéresse.
 */
export const DEFAULT_PLANS: readonly PlanDefaults[] = [
  {
    id: 'vis-essai',
    name: 'Essai',
    description:
      'Un audit complet de votre site, ses deux notes et vos premières priorités. De quoi savoir ce qui vous manque avant de payer quoi que ce soit.',
    priceCents: 0,
    currency: 'CHF',
    /*
     * Un seul audit, et c'est tout l'objet de cette offre : montrer ce que le produit
     * trouve chez vous. Les corrections rédigées par l'IA, elles, coûtent de l'argent à
     * Evoliia — d'où une réserve de crédits volontairement courte.
     */
    sitesMax: 1,
    pagesPerAudit: 20,
    auditsPerMonth: 1,
    monthlyCredits: 20,
    maxProjects: 0,
    maxConnections: 0,
    features: DEFAULT_PLAN_FEATURES['vis-essai'] ?? [],
    storageBytes: 0,
    radarRunsPerMonth: 0,
    liaAnswersPerMonth: 0,
    liaConversationsPerMonth: 0,
    alertsPerMonth: 0,
    imagesPerMonth: 0,
    allowBuild: false,
    allowExport: false,
    allowCustomDomain: false,
    allowMobilePrep: false,
    isRecommended: false,
    sortOrder: 0,
  },
  {
    id: 'vis-starter',
    name: 'Starter',
    description:
      'Pour les indépendants, artisans et petites entreprises qui veulent commencer à améliorer leur visibilité.',
    priceCents: 1900,
    currency: 'CHF',
    sitesMax: 1,
    pagesPerAudit: 50,
    auditsPerMonth: 4,
    monthlyCredits: 150,
    maxProjects: 0,
    maxConnections: 1,
    features: DEFAULT_PLAN_FEATURES['vis-starter'] ?? [],
    storageBytes: 0,
    radarRunsPerMonth: 0,
    liaAnswersPerMonth: 0,
    liaConversationsPerMonth: 0,
    alertsPerMonth: 0,
    imagesPerMonth: 0,
    allowBuild: false,
    allowExport: false,
    allowCustomDomain: false,
    allowMobilePrep: false,
    isRecommended: false,
    sortOrder: 1,
  },
  {
    id: 'vis-pro',
    name: 'Pro',
    description:
      'Pour les e-commerçants et les entreprises qui travaillent leur visibilité régulièrement.',
    priceCents: 4900,
    currency: 'CHF',
    sitesMax: 3,
    pagesPerAudit: 250,
    auditsPerMonth: 12,
    monthlyCredits: 600,
    maxProjects: 0,
    maxConnections: 3,
    features: DEFAULT_PLAN_FEATURES['vis-pro'] ?? [],
    storageBytes: 0,
    radarRunsPerMonth: 0,
    liaAnswersPerMonth: 0,
    liaConversationsPerMonth: 0,
    alertsPerMonth: 0,
    imagesPerMonth: 0,
    allowBuild: false,
    allowExport: false,
    allowCustomDomain: false,
    allowMobilePrep: false,
    // L'offre du milieu est celle qui convient au plus grand nombre : la mettre en avant
    // évite à la plupart des gens un arbitrage qu'ils n'ont pas les moyens de faire.
    isRecommended: true,
    sortOrder: 2,
  },
  {
    id: 'vis-business',
    name: 'Business',
    description:
      'Pour les entreprises, les petites agences et ceux qui suivent plusieurs sites ou produisent beaucoup de contenu.',
    priceCents: 9900,
    currency: 'CHF',
    sitesMax: 10,
    pagesPerAudit: 1000,
    auditsPerMonth: 40,
    monthlyCredits: 1500,
    maxProjects: 0,
    maxConnections: 10,
    features: DEFAULT_PLAN_FEATURES['vis-business'] ?? [],
    storageBytes: 0,
    radarRunsPerMonth: 0,
    liaAnswersPerMonth: 0,
    liaConversationsPerMonth: 0,
    alertsPerMonth: 0,
    imagesPerMonth: 0,
    allowBuild: false,
    allowExport: true,
    allowCustomDomain: false,
    allowMobilePrep: false,
    isRecommended: false,
    sortOrder: 3,
  },
] as const

/*
 * L'identifiant de l'offre d'entrée du produit de visibilité.
 *
 * Il est préfixé, et cela vient d'un vrai défaut. Les identifiants « starter », « pro » et
 * « business » existaient déjà, d'un catalogue précédent, avec d'autres prix et d'autres
 * réserves. Or le semis ne réécrit jamais une offre déjà en base — elle appartient à
 * l'exploitant —, si bien que les nouvelles offres auraient hérité en silence des valeurs
 * des anciennes : un prix en euros au lieu de francs, huit cents crédits au lieu de mille
 * cinq cents. Le client aurait vu le bon nom et le mauvais chiffre.
 *
 * Un préfixe sépare les deux générations une fois pour toutes. Les anciennes offres sont
 * désactivées par le semis, jamais supprimées : des abonnements les référencent encore.
 */
export const FREE_PLAN_ID = 'vis-essai'

/** Capacité d'offre, au sens d'un interrupteur booléen de la table `Plan`. */
export type PlanCapability =
  | 'allowBuild'
  | 'allowCustomDomain'
  | 'allowExport'
  | 'allowMobilePrep'

/**
 * Capacités réellement construites aujourd'hui.
 *
 * Une offre ne doit jamais annoncer autre chose que ce que le produit sait faire. La règle
 * est née d'un vrai défaut : la grille tarifaire annonçait « Export du code » et
 * « Préparation pour mobile », deux cases cochées en base sans une ligne derrière. Les
 * deux existent désormais — l'export produit un site qui s'ouvre depuis un dossier, la
 * préparation mobile un dossier de publication — et la liste des capacités seulement
 * prévues est vide. Elle reste là : la prochaine capacité imaginée s'y écrira avant d'être
 * construite, et le test l'empêchera d'être vendue entre-temps.
 */
export const IMPLEMENTED_PLAN_CAPABILITIES: readonly PlanCapability[] = [
  'allowBuild',
  'allowExport',
  'allowMobilePrep',
]

/**
 * Le nom de domaine personnalisé n'existe pas encore : l'atelier l'annonce comme « prévu »,
 * aucune route ne le sert. Tant qu'il est ici, le démarrage l'éteint sur toutes les offres
 * et la grille tarifaire ne l'affiche pas.
 */
export const PLANNED_PLAN_CAPABILITIES: readonly PlanCapability[] = ['allowCustomDomain']

/** Renvoie le plan effectif d'un utilisateur, en retombant sur l'offre gratuite. */
export async function getEffectivePlan(userId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  })
  if (subscription && (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING')) {
    return subscription.plan
  }
  const free = await prisma.plan.findUnique({ where: { id: FREE_PLAN_ID } })
  if (free) return free
  // Filet : la base n'a pas encore été initialisée.
  const defaults = DEFAULT_PLANS[0]!
  return {
    ...defaults,
    interval: 'month',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/**
 * Offres affichées publiquement, dans l'ordre défini en base.
 *
 * La grille tarifaire de la page d'accueil lit cette fonction : aucun prix n'est écrit
 * dans une page, ils restent modifiables depuis la table `Plan` (exigence 34).
 */
export async function listPublicPlans() {
  return prisma.plan.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
  })
}
