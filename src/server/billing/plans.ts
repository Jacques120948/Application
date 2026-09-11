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
  allowExport: boolean
  allowCustomDomain: boolean
  allowMobilePrep: boolean
  sortOrder: number
}

export const DEFAULT_PLANS: readonly PlanDefaults[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Pour tester une première idée et publier une application sur le web.',
    priceCents: 0,
    maxProjects: 1,
    monthlyCredits: 300,
    allowExport: false,
    allowCustomDomain: false,
    allowMobilePrep: false,
    sortOrder: 0,
  },
  {
    id: 'creator',
    name: 'Creator',
    description: 'Plusieurs applications, davantage de crédits, export du projet.',
    priceCents: 1900,
    maxProjects: 5,
    monthlyCredits: 2000,
    allowExport: true,
    allowCustomDomain: true,
    allowMobilePrep: false,
    sortOrder: 1,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Volume de projets et de crédits élevé, préparation iOS et Android.',
    priceCents: 4900,
    maxProjects: 25,
    monthlyCredits: 8000,
    allowExport: true,
    allowCustomDomain: true,
    allowMobilePrep: true,
    sortOrder: 2,
  },
] as const

export const FREE_PLAN_ID = 'starter'

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
