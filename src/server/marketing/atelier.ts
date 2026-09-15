import { z } from 'zod'
import { AppError, notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { consume, RULES } from '@/server/auth/rate-limit'
import { creditsForCost, ensureCredits, spendCredits } from '@/server/billing/credits'
import type { CreditedOperation } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { costMicros } from '@/server/ai/routing'
import { appSpecSchema } from '@/server/spec/schema'
import {
  launchKitSchema,
  monthlyPlanSchema,
  NETWORKS,
  VARIATION_INTENTS,
  type MonthlyPlan,
  type Variation,
} from '@/lib/marketing'
import { toBrandContext } from './context'
import { isEngineAvailable, requestMonth, requestVariations, type EngineUsage } from './engine'
import { publicAppUrl } from '@/lib/apps-domain'

/**
 * L'atelier du kit : retravailler une publication, prolonger la semaine en mois.
 *
 * Ces deux capacités viennent après le kit, et elles en dépendent : on ne retravaille pas
 * un texte qui n'existe pas, on ne prolonge pas une semaine qui n'a pas été préparée. Le
 * service refuse donc proprement plutôt que de proposer un bouton qui échouerait.
 *
 * Le même ordre que partout ailleurs, et pour les mêmes raisons. Les droits d'abord : une
 * fonction fermée ne doit pas consommer un appel réseau. Le solde ensuite, avant le premier
 * appel. Le débit en dernier, sur les jetons réellement consommés — un moteur en panne ne
 * coûte rien au créateur.
 */

export const FEATURE_VARIATIONS = 'social_content_generation'
export const FEATURE_MONTH = 'social_calendar'

/**
 * Coûts annoncés avant de lancer l'opération.
 *
 * Ce sont les planchers déclarés dans credits.ts. Le coût réel est celui des jetons
 * consommés ; ces valeurs servent à prévenir, jamais à facturer.
 */
export const VARIATION_ESTIMATED_CREDITS = 2
export const MONTH_ESTIMATED_CREDITS = 12

export const variationInput = z.object({
  kitId: z.string().uuid(),
  /** Rang de la publication dans la semaine du kit. */
  index: z.number().int().min(0).max(9),
  intent: z.enum(VARIATION_INTENTS),
  tone: z.string().trim().min(2).max(60).optional(),
  network: z.enum(NETWORKS).optional(),
  count: z.number().int().min(1).max(3).default(2),
})

export const monthInput = z.object({ kitId: z.string().uuid() })

export type VariationView = { variations: Variation[]; creditsSpent: number }
export type MonthView = { plan: MonthlyPlan; creditsSpent: number }

/** Le kit et le projet qui le porte, relus ensemble. Les deux sont nécessaires au moteur. */
async function readKitAndProject(userId: string, kitId: string) {
  const kit = await withUserScope(userId, (tx) =>
    tx.marketingKit.findFirst({
      where: { id: kitId, userId },
      select: { id: true, projectId: true, content: true, month: true },
    }),
  )
  if (kit === null) throw notFound("Ce kit n'existe pas.")

  const project = await withUserScope(userId, (tx) =>
    tx.project.findFirst({
      where: { id: kit.projectId, ownerId: userId, deletedAt: null },
      select: {
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

  const parsed = launchKitSchema.safeParse(kit.content)
  if (!parsed.success) {
    throw new AppError('UNSUPPORTED_REQUEST', "Ce kit n'est pas relisible.")
  }

  const spec = appSpecSchema.safeParse(project.draftSpec)
  const brand = toBrandContext({
    project: { name: project.name, idea: project.idea, locale: project.locale },
    spec: spec.success ? spec.data : null,
    idea: project.sourceIdea,
    publicUrl:
      project.publishedAt === null ? null : publicAppUrl(project.slug),
  })

  return { kit, content: parsed.data, brand, projectId: kit.projectId }
}

/** Inscrit la consommation réelle et débite. Identique pour les deux opérations. */
async function settle(
  userId: string,
  projectId: string,
  operation: CreditedOperation,
  usage: EngineUsage,
  startedAt: number,
): Promise<number> {
  const cost = costMicros(usage.model, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
  })
  const credits = creditsForCost(operation, cost)

  await prisma.aiUsage
    .create({
      data: {
        userId,
        projectId,
        operation,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        costMicros: cost,
        creditsSpent: credits,
        latencyMs: Date.now() - startedAt,
        success: true,
      },
    })
    .catch(() => undefined)

  await spendCredits(userId, credits, `ia:${operation}`, projectId)
  return credits
}

function assertEngine(): void {
  if (!isEngineAvailable()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      "Le module marketing n'est pas encore activé sur cette installation.",
    )
  }
}

/**
 * Plusieurs façons de dire la même publication.
 *
 * Les versions ne sont pas enregistrées : ce sont des propositions. Le créateur en retient
 * une, qui devient la publication — et c'est l'enregistrement du kit qui la conserve. Garder
 * les versions écartées encombrerait la base d'un brouillon que personne ne relira.
 */
export async function createVariations(
  userId: string,
  input: z.infer<typeof variationInput>,
): Promise<VariationView> {
  const entitlements = await getEntitlements(userId)
  requireFeature(entitlements, FEATURE_VARIATIONS)
  assertEngine()

  const { content, brand, projectId } = await readKitAndProject(userId, input.kitId)
  const post = content.week[input.index]
  if (post === undefined) {
    throw notFound("Cette publication n'existe pas dans ce kit.")
  }

  consume(`variation:${userId}`, RULES.aiOperation)
  await ensureCredits(userId, 'contentVariation')

  const startedAt = Date.now()
  const result = await requestVariations({
    caller: {
      userRef: userId,
      projectRef: projectId,
      plan: entitlements.planId,
      action: 'variation',
    },
    brand,
    post: {
      angleKey: post.angleKey,
      objective: post.objective,
      format: post.format,
      caption: post.caption,
      hashtags: post.hashtags,
      cta: post.cta,
    },
    intent: input.intent,
    ...(input.tone === undefined ? {} : { tone: input.tone }),
    ...(input.network === undefined ? {} : { network: input.network }),
    count: input.count,
  })

  const credits = await settle(userId, projectId, 'contentVariation', result.usage, startedAt)
  logger.info('variations produites', {
    projectId,
    intent: input.intent,
    count: result.variations.length,
    credits,
  })

  return { variations: result.variations, creditsSpent: credits }
}

/**
 * Le mois, à partir des angles déjà retenus.
 *
 * Il n'est préparé qu'après approbation du kit. Prolonger une semaine que le créateur n'a
 * pas relue multiplierait par quatre un texte qu'il finira peut-être par réécrire — et
 * lui ferait payer les deux fois.
 */
export async function createMonth(
  userId: string,
  input: z.infer<typeof monthInput>,
): Promise<MonthView> {
  const entitlements = await getEntitlements(userId)
  requireFeature(entitlements, FEATURE_MONTH)
  assertEngine()

  const { kit, content, brand, projectId } = await readKitAndProject(userId, input.kitId)
  if (content.angles.length === 0) {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      "Ce kit ne contient aucun angle : il n'y a rien sur quoi bâtir un mois.",
    )
  }

  consume(`mois:${userId}`, RULES.aiOperation)
  await ensureCredits(userId, 'monthlyPlan')

  const startedAt = Date.now()
  const result = await requestMonth({
    caller: {
      userRef: userId,
      projectRef: projectId,
      plan: entitlements.planId,
      action: 'month',
    },
    brand,
    angles: content.angles,
  })

  const plan = monthlyPlanSchema.safeParse(result.plan)
  if (!plan.success) {
    logger.error('calendrier mensuel non conforme au contrat', { projectId })
    throw new AppError(
      'AI_UNAVAILABLE',
      'Le module marketing a renvoyé une réponse inattendue. Réessayez dans un instant.',
    )
  }

  const credits = await settle(userId, projectId, 'monthlyPlan', result.usage, startedAt)

  await withUserScope(userId, (tx) =>
    tx.marketingKit.update({ where: { id: kit.id }, data: { month: plan.data } }),
  )

  logger.info('calendrier mensuel produit', {
    projectId,
    posts: plan.data.posts.length,
    credits,
  })

  return { plan: plan.data, creditsSpent: credits }
}

/** Le mois déjà préparé, s'il existe. Ne déclenche aucun appel au moteur. */
export function readMonth(stored: unknown): MonthlyPlan | null {
  if (stored === null || stored === undefined) return null
  const parsed = monthlyPlanSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}
