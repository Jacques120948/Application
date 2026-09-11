import { prisma } from '@/server/db/client'

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
  monthlyCredits: number
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
    id: 'free',
    name: 'Découverte',
    description:
      "Définissez votre objectif, recevez des idées adaptées à votre profil et faites analyser celle qui vous plaît.",
    priceCents: 0,
    maxProjects: 0,
    // Mesuré à l'usage : une recherche d'idées coûte environ 12 crédits et une analyse
    // approfondie environ 7. L'offre de découverte doit couvrir au moins une recherche
    // et deux analyses, sinon elle s'arrête avant d'avoir montré sa valeur.
    monthlyCredits: 30,
    allowBuild: false,
    allowExport: false,
    allowCustomDomain: false,
    allowMobilePrep: false,
    isRecommended: false,
    sortOrder: 0,
  },
  {
    id: 'launch',
    name: 'Launch',
    description: 'Pour lancer votre première application et la mettre en ligne.',
    priceCents: 2900,
    maxProjects: 1,
    monthlyCredits: 100,
    allowBuild: true,
    allowExport: false,
    allowCustomDomain: false,
    allowMobilePrep: false,
    isRecommended: false,
    sortOrder: 1,
  },
  {
    id: 'builder',
    name: 'Builder',
    description: 'Plusieurs projets, accompagnement au lancement et adresse personnalisée.',
    priceCents: 5900,
    maxProjects: 5,
    monthlyCredits: 350,
    allowBuild: true,
    allowExport: false,
    allowCustomDomain: true,
    allowMobilePrep: true,
    isRecommended: true,
    sortOrder: 2,
  },
  {
    id: 'business',
    name: 'Business',
    description: "Pour exploiter plusieurs applications et aller plus loin dans l'acquisition.",
    priceCents: 9900,
    maxProjects: 20,
    monthlyCredits: 800,
    allowBuild: true,
    allowExport: true,
    allowCustomDomain: true,
    allowMobilePrep: true,
    isRecommended: false,
    sortOrder: 3,
  },
] as const

export const FREE_PLAN_ID = 'free'

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
    currency: 'EUR',
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
