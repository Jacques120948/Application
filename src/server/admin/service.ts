import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { notFound } from '@/lib/errors'
import { getCurrentUser } from '@/server/auth/session'
import { logger } from '@/server/observability/logger'
import { FREE_PLAN_ID, PLANNED_PLAN_CAPABILITIES } from '@/server/billing/plans'
import { countPublishedApps } from '@/server/runtime/published'
import {
  getLegalIdentity,
  legalIdentityInput,
  saveLegalIdentity,
} from '@/server/settings/legal'

/**
 * Back-office.
 *
 * Il remplace les requêtes SQL qu'il fallait jusqu'ici écrire à la main pour changer un
 * prix ou attribuer une offre. Deux principes :
 *
 *   1. Une seule porte. `requireAdmin()` est appelé au début de chaque opération, y
 *      compris en lecture. Un visiteur non administrateur reçoit « introuvable » plutôt
 *      qu'« interdit » : inutile de lui apprendre que cette page existe.
 *   2. Aucune table protégée n'est lue ici. Le Row Level Security masque les projets et
 *      les idées des autres, et ce n'est pas au back-office de le contourner. Les
 *      compteurs portent donc sur ce qui est public ou global.
 */

export async function requireAdmin() {
  const user = await getCurrentUser()
  if (user === null || user.role !== 'ADMIN') throw notFound()
  return user
}

// ───────────────────────────────── Offres ────────────────────────────────────

export const planUpdateInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(400),
  priceCents: z.number().int().min(0).max(1_000_000),
  maxProjects: z.number().int().min(0).max(1_000),
  monthlyCredits: z.number().int().min(0).max(1_000_000),
  allowBuild: z.boolean(),
  allowCustomDomain: z.boolean(),
  isRecommended: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(100),
})

export type PlanUpdateInput = z.infer<typeof planUpdateInput>

export async function listPlans() {
  await requireAdmin()
  return prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] })
}

/**
 * Les capacités non construites ne sont pas modifiables ici : les exposer reviendrait à
 * offrir un bouton qui promet une fonction inexistante. Elles sont forcées à faux.
 */
export async function updatePlan(planId: string, input: PlanUpdateInput) {
  const admin = await requireAdmin()
  const existing = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } })
  if (existing === null) throw notFound("Cette offre n'existe pas.")

  const plan = await prisma.$transaction(async (tx) => {
    // Une seule offre mise en avant : cocher celle-ci décoche les autres.
    if (input.isRecommended) {
      await tx.plan.updateMany({
        where: { id: { not: planId }, isRecommended: true },
        data: { isRecommended: false },
      })
    }
    return tx.plan.update({
      where: { id: planId },
      data: {
        ...input,
        ...Object.fromEntries(PLANNED_PLAN_CAPABILITIES.map((capability) => [capability, false])),
      },
    })
  })

  logger.info('offre modifiée', { adminId: admin.id, planId })
  return plan
}

// ──────────────────────────────── Comptes ────────────────────────────────────

export const userSearchInput = z.object({
  query: z.string().trim().max(120).default(''),
  take: z.number().int().min(1).max(100).default(50),
})

export async function listUsers(input: z.infer<typeof userSearchInput>) {
  await requireAdmin()
  const users = await prisma.user.findMany({
    where:
      input.query === ''
        ? {}
        : {
            OR: [
              { email: { contains: input.query, mode: 'insensitive' } },
              { name: { contains: input.query, mode: 'insensitive' } },
            ],
          },
    orderBy: { createdAt: 'desc' },
    take: input.take,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      disabledAt: true,
      subscription: { select: { planId: true, status: true } },
      wallet: { select: { balance: true, monthlyGrant: true } },
    },
  })

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    disabled: user.disabledAt !== null,
    planId: user.subscription?.planId ?? FREE_PLAN_ID,
    subscriptionStatus: user.subscription?.status ?? null,
    credits: user.wallet?.balance ?? 0,
  }))
}

export const setPlanInput = z.object({
  /** `null` ramène le compte à l'offre gratuite en supprimant son abonnement. */
  planId: z.string().trim().min(1).max(48).nullable(),
})

export async function setUserPlan(userId: string, planId: string | null) {
  const admin = await requireAdmin()

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (user === null) throw notFound("Ce compte n'existe pas.")

  if (planId === null || planId === FREE_PLAN_ID) {
    await prisma.subscription.deleteMany({ where: { userId } })
    logger.info('offre retirée', { adminId: admin.id, userId })
    return
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } })
  if (plan === null) throw notFound("Cette offre n'existe pas.")

  await prisma.subscription.upsert({
    where: { userId },
    update: { planId, status: 'ACTIVE' },
    create: { userId, planId, status: 'ACTIVE' },
  })
  logger.info('offre attribuée', { adminId: admin.id, userId, planId })
}

// ──────────────────────────────── Chiffres ───────────────────────────────────

export async function getAdminOverview() {
  await requireAdmin()
  const [users, subscriptions, publishedApps, activePlans] = await Promise.all([
    prisma.user.count(),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    countPublishedApps(),
    prisma.plan.count({ where: { isActive: true } }),
  ])
  return { users, subscriptions, publishedApps, activePlans }
}

// ──────────────────────────── Identité légale ────────────────────────────────

export { legalIdentityInput }

export async function readLegalIdentity() {
  await requireAdmin()
  return getLegalIdentity()
}

export async function updateLegalIdentity(
  input: Parameters<typeof saveLegalIdentity>[0],
): Promise<void> {
  const admin = await requireAdmin()
  await saveLegalIdentity(input)
  logger.info('identité légale enregistrée', { adminId: admin.id })
}
