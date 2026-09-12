import { z } from 'zod'
import { AppError, notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { consume, RULES } from '@/server/auth/rate-limit'
import { creditsForCost, ensureCredits, spendCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { LAUNCH_KIT_FEATURE, requireFeature } from '@/server/billing/features'
import { costMicros } from '@/server/ai/routing'
import { appSpecSchema } from '@/server/spec/schema'
import { launchKitSchema, type LaunchKit } from '@/lib/marketing'
import { toBrandContext } from './context'
import { isEngineAvailable, requestLaunchKit } from './engine'

/**
 * Kit de lancement d'un projet.
 *
 * C'est ici que se rejoignent les trois règles qui gouvernent cette intégration :
 *
 *   1. **Les droits d'abord.** Aucune condition sur le nom d'une offre : on demande à la
 *      couche d'entitlements si la fonction est ouverte, elle seule sait répondre.
 *   2. **Le solde ensuite, le débit après.** Les crédits sont vérifiés avant le premier
 *      appel réseau et débités seulement si le moteur a répondu. Un moteur en panne ne
 *      coûte rien au créateur.
 *   3. **Le coût est mesuré, pas estimé.** Le moteur renvoie les jetons réellement
 *      consommés ; Evoliia les inscrit dans son propre journal. C'est ce qui permettra de
 *      calculer la marge d'une offre à 29, 59 ou 99 francs sans deviner.
 */

export { LAUNCH_KIT_FEATURE } from '@/server/billing/features'

/**
 * Coût annoncé avant de lancer la préparation.
 *
 * Mesuré, pas estimé : un premier kit complet en conditions réelles a coûté 11 crédits.
 * Annoncer un chiffre plus flatteur ferait une mauvaise surprise à celui qui regarde son
 * solde après coup. À réviser si la taille des kits change.
 */
export const LAUNCH_KIT_ESTIMATED_CREDITS = 11

export type KitView = {
  id: string
  projectId: string
  content: LaunchKit
  approvedAt: string | null
  createdAt: string
  creditsSpent: number
}

export const approveInput = z.object({ kitId: z.string().uuid() })

export const updateKitInput = z.object({
  kitId: z.string().uuid(),
  content: launchKitSchema,
})

/** Dernier kit d'un projet, ou null. Ne déclenche aucun appel au moteur. */
export async function getLatestKit(userId: string, projectId: string): Promise<KitView | null> {
  const row = await withUserScope(userId, (tx) =>
    tx.marketingKit.findFirst({
      where: { userId, projectId },
      orderBy: { createdAt: 'desc' },
    }),
  )
  if (row === null) return null

  const parsed = launchKitSchema.safeParse(row.content)
  if (!parsed.success) {
    // Un kit produit par une version antérieure du moteur ne doit pas casser l'écran.
    logger.warn('kit marketing illisible', { projectId, engineVersion: row.engineVersion })
    return null
  }

  return {
    id: row.id,
    projectId: row.projectId,
    content: parsed.data,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    creditsSpent: row.creditsSpent,
  }
}

export async function createLaunchKit(userId: string, projectId: string): Promise<KitView> {
  const entitlements = await getEntitlements(userId)
  requireFeature(entitlements, LAUNCH_KIT_FEATURE)

  if (!isEngineAvailable()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      "Le module marketing n'est pas encore activé sur cette installation.",
    )
  }

  const project = await withUserScope(userId, (tx) =>
    tx.project.findFirst({
      where: { id: projectId, ownerId: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        idea: true,
        locale: true,
        draftSpec: true,
        publishedAt: true,
        sourceIdea: {
          select: {
            title: true,
            problem: true,
            audience: true,
            valueProposition: true,
            features: true,
            differentiators: true,
            recommendedPriceCents: true,
            priceInterval: true,
            currency: true,
          },
        },
      },
    }),
  )
  if (project === null) throw notFound("Ce projet n'existe pas.")

  consume(`marketing:${userId}`, RULES.aiOperation)
  await ensureCredits(userId, 'launchKit')

  const spec = appSpecSchema.safeParse(project.draftSpec)
  const appUrl = process.env.APP_URL ?? ''
  const brand = toBrandContext({
    project: { name: project.name, idea: project.idea, locale: project.locale },
    spec: spec.success ? spec.data : null,
    idea: project.sourceIdea,
    publicUrl:
      project.publishedAt === null || appUrl === '' ? null : `${appUrl}/a/${project.slug}`,
  })

  const startedAt = Date.now()
  const result = await requestLaunchKit({
    caller: {
      // Le moteur ne reçoit aucune identité réelle : ni adresse, ni nom. Une référence
      // opaque suffit à relier une trace à une demande.
      userRef: userId,
      projectRef: projectId,
      plan: entitlements.planId,
      action: 'launch-kit',
    },
    brand,
  })

  const kit = launchKitSchema.safeParse(result.kit)
  if (!kit.success) {
    logger.error('kit marketing non conforme au contrat', { projectId })
    throw new AppError(
      'AI_UNAVAILABLE',
      "Le module marketing a renvoyé une réponse inattendue. Réessayez dans un instant.",
    )
  }

  const cost = costMicros(result.usage.model, {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cachedTokens: result.usage.cachedTokens,
  })
  const credits = creditsForCost('launchKit', cost)

  await prisma.aiUsage
    .create({
      data: {
        userId,
        projectId,
        operation: 'launchKit',
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        costMicros: cost,
        creditsSpent: credits,
        latencyMs: Date.now() - startedAt,
        success: true,
      },
    })
    .catch(() => undefined)

  await spendCredits(userId, credits, 'ia:launchKit', projectId)

  const saved = await withUserScope(userId, (tx) =>
    tx.marketingKit.create({
      data: {
        userId,
        projectId,
        engineVersion: result.engineVersion,
        content: kit.data,
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        costMicros: cost,
        creditsSpent: credits,
      },
    }),
  )

  logger.info('kit de lancement produit', {
    userId,
    projectId,
    plan: entitlements.planId,
    model: result.usage.model,
    costMicros: cost,
    credits,
    durationMs: Date.now() - startedAt,
  })

  return {
    id: saved.id,
    projectId,
    content: kit.data,
    approvedAt: null,
    createdAt: saved.createdAt.toISOString(),
    creditsSpent: credits,
  }
}

/** Le créateur corrige ce que le moteur a proposé. Rien n'est publié à ce stade. */
export async function updateKit(
  userId: string,
  input: z.infer<typeof updateKitInput>,
): Promise<KitView> {
  const updated = await withUserScope(userId, async (tx) => {
    const found = await tx.marketingKit.findFirst({
      where: { id: input.kitId, userId },
      select: { id: true },
    })
    if (found === null) return null
    return tx.marketingKit.update({
      where: { id: found.id },
      data: { content: input.content },
    })
  })
  if (updated === null) throw notFound("Ce kit n'existe pas.")

  return {
    id: updated.id,
    projectId: updated.projectId,
    content: input.content,
    approvedAt: updated.approvedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    creditsSpent: updated.creditsSpent,
  }
}

/**
 * Approbation par le créateur.
 *
 * Elle ne publie rien et n'engage rien : aucun réseau social n'est connecté aujourd'hui.
 * Elle dit seulement « j'ai relu, cela me convient ». C'est ce geste qui deviendra le point
 * de passage obligatoire le jour où une publication partira réellement.
 */
export async function approveKit(userId: string, kitId: string): Promise<void> {
  const approved = await withUserScope(userId, (tx) =>
    tx.marketingKit.updateMany({
      where: { id: kitId, userId },
      data: { approvedAt: new Date() },
    }),
  )
  if (approved.count === 0) throw notFound("Ce kit n'existe pas.")
}
