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
  /**
   * Douze mois payés d'avance, en centimes. Zéro : l'offre ne se prend pas à l'année.
   *
   * Réglé à dix mensualités — « deux mois offerts ». La formule est choisie plutôt que le
   * pourcentage rond parce qu'elle se comprend sans calculer : « 20 % » demande une
   * multiplication pour savoir ce qu'on économise, « deux mois offerts » se lit. Elle coûte
   * d'ailleurs moins cher — 16 % au lieu de 20 — et c'est la remise annuelle la plus
   * répandue, donc celle qu'on reconnaît.
   *
   * Comme le reste, ce n'est qu'une valeur de départ : l'exploitant la règle depuis le
   * back-office, et le pourcentage annoncé se déduit des deux prix. Aucun taux n'est stocké.
   */
  priceYearCents: number
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
   * Images créées par l'IA sur le compte d'Evoliia, pour illustrer un article.
   *
   * C'est le seul quota derrière lequel il y a de l'argent qui sort à chaque usage —
   * environ quatre centimes l'image — là où le reste ne borne que du calcul déjà payé. Il
   * ne s'ouvre donc que sur les deux offres hautes, et la fonction reste éteinte tant que
   * l'exploitant n'a pas levé l'interrupteur qui la commande : les deux bornes se cumulent
   * au lieu de se remplacer.
   *
   * Soixante images sur Business représentent environ deux francs quarante de dépense
   * mensuelle par abonné, contre cent soixante-dix-neuf francs encaissés. Vingt sur Pro,
   * quatre-vingts centimes contre soixante-dix-neuf francs. La proportion est ce qui permet
   * d'ouvrir la fonction sans la surveiller.
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
 * Valeurs de départ. La table `Plan` fait foi : l'exploitant les règle sans redéploiement.
 *
 * Les prix ne sont pas calés sur le coût d'Evoliia, et c'est volontaire. Ils le seraient
 * qu'ils vaudraient quelques francs : à cinq millièmes de dollar le crédit, la plus grosse
 * offre coûte moins de sept francs d'API par mois quand elle est entièrement consommée. Un
 * prix calé sur ce coût ne dirait rien de ce qu'on reçoit — il dirait seulement que le
 * calcul est bon marché, ce que personne n'achète.
 *
 * Ils sont donc calés sur ce que l'abonné obtient, et l'échelle suit ce qui change d'une
 * offre à l'autre : le nombre de sites, la profondeur de l'analyse, le nombre d'audits, la
 * réserve de crédits, et surtout les fonctions ouvertes. La plus haute ouvre Naya et MIRA,
 * c'est-à-dire la lecture **et** la modification de comptes Google Ads et Meta — un travail
 * qu'une agence facture plusieurs centaines de francs par mois. C'est ce qui justifie
 * l'écart avec l'offre du milieu, pas une règle de trois sur les crédits.
 *
 * Le prix par crédit décroît quand l'offre monte — 0,19 puis 0,13 puis 0,12 franc — ce qui
 * est la seule contrainte structurelle à tenir : une offre supérieure dont le crédit
 * coûterait plus cher donnerait à quelqu'un une raison de rester en dessous.
 *
 * L'offre gratuite montre ce que le produit trouve chez vous et s'arrête là : un audit, sa
 * note, ses priorités. C'est là que se situe la décision d'abonnement.
 */
export const DEFAULT_PLANS: readonly PlanDefaults[] = [
  {
    id: 'vis-essai',
    name: 'Essai',
    description:
      'Un audit complet de votre site, ses deux notes et vos premières priorités. De quoi savoir ce qui vous manque avant de payer quoi que ce soit.',
    priceCents: 0,
    priceYearCents: 0,
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
    priceCents: 2900,
    priceYearCents: 29_000,
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
    priceCents: 7900,
    priceYearCents: 79_000,
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
    imagesPerMonth: 20,
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
    priceCents: 17_900,
    priceYearCents: 179_000,
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
    imagesPerMonth: 60,
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
