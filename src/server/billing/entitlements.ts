import { prisma } from '@/server/db/client'
import { getEffectivePlan } from './plans'
import { resolveEntitlements, type Entitlements } from './features'

/**
 * Droits d'une personne, lus en base.
 *
 * Séparé du catalogue de fonctions pour que celui-ci reste pur et testable sans base. Tout
 * le reste du code passe par ici, jamais par le nom d'une offre.
 */
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const [plan, plans] = await Promise.all([
    getEffectivePlan(userId),
    prisma.plan.findMany({
      where: { isActive: true },
      select: { id: true, name: true, features: true, sortOrder: true },
    }),
  ])

  return resolveEntitlements(
    { id: plan.id, name: plan.name, features: [...(plan.features ?? [])] },
    plans,
  )
}
