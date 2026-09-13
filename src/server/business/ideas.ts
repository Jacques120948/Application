import type { Prisma } from '@prisma/client'
import { AppError, notFound } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import { withUserScope } from '@/server/db/scope'
import { isAiAvailable } from '@/server/ai/client'
import { suggestIdeas, validateIdea, writeSpecSheet } from '@/server/ai/operations'
import type { IdeaSuggestion, IdeaValidation, SpecSheet } from '@/server/ai/schemas'
import {
  customersNeededFor,
  describeObjective,
  MIXED_CURRENCY_NOTICE,
  type PriceInterval,
} from './economics'
import { requireProfile, toAssistantProfile } from './profile'

/**
 * Module « trouver et valider une idée ».
 *
 * C'est le cœur de la différence du produit : la plateforme ne demande pas ce que
 * l'utilisateur veut construire, elle lui propose quoi construire, chiffré et comparable.
 *
 * Règle absolue : aucun montant de revenu ne vient du modèle. Le prix conseillé est
 * proposé par l'assistant, mais le nombre de clients et la phrase associée sont calculés
 * ici, par server/business/economics.ts.
 */

export type ScoredIdea = {
  id: string
  title: string
  problem: string
  audience: string
  valueProposition: string
  features: string[]
  businessModel: string
  recommendedPriceCents: number
  priceInterval: PriceInterval
  /** Monnaie dans laquelle l'idée a été chiffrée, figée à sa création. */
  currency: string
  /** Faux si l'idée a été chiffrée dans une autre monnaie que l'objectif courant. */
  comparableToObjective: boolean
  opportunityScore: number
  demandLevel: string
  competitionLevel: string
  complexityLevel: string
  operatingCostLevel: string
  timeToMarketWeeks: number
  /** Coût de fonctionnement mensuel estimé de l'application, en centimes. */
  runningCostCents: number
  customersNeeded: number
  risks: string[]
  differentiators: string[]
  status: 'PROPOSED' | 'SELECTED' | 'DISCARDED'
  /** Phrase honnête liant le prix à l'objectif, produite par la plateforme. */
  objectiveSentence: string
  validation: IdeaValidation | null
  specSheet: SpecSheet | null
  projectId: string | null
}

function asStrings(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function present(
  row: {
    id: string
    title: string
    problem: string
    audience: string
    valueProposition: string
    features: Prisma.JsonValue
    businessModel: string
    recommendedPriceCents: number
    currency: string
    priceInterval: string
    opportunityScore: number
    demandLevel: string
    competitionLevel: string
    complexityLevel: string
    operatingCostLevel: string
    timeToMarketWeeks: number
    runningCostCents: number
    customersNeeded: number
    risks: Prisma.JsonValue
    differentiators: Prisma.JsonValue
    status: string
    validation: Prisma.JsonValue | null
    specSheet: Prisma.JsonValue | null
    project?: { id: string } | null
  },
  profile: { monthlyGoalCents: number; currency: string },
): ScoredIdea {
  const interval = row.priceInterval as PriceInterval
  const comparable = row.currency === profile.currency
  return {
    id: row.id,
    title: row.title,
    problem: row.problem,
    audience: row.audience,
    valueProposition: row.valueProposition,
    features: asStrings(row.features),
    businessModel: row.businessModel,
    recommendedPriceCents: row.recommendedPriceCents,
    priceInterval: interval,
    currency: row.currency,
    comparableToObjective: comparable,
    opportunityScore: row.opportunityScore,
    demandLevel: row.demandLevel,
    competitionLevel: row.competitionLevel,
    complexityLevel: row.complexityLevel,
    operatingCostLevel: row.operatingCostLevel,
    timeToMarketWeeks: row.timeToMarketWeeks,
    runningCostCents: row.runningCostCents,
    customersNeeded: row.customersNeeded,
    risks: asStrings(row.risks),
    differentiators: asStrings(row.differentiators),
    status: row.status as ScoredIdea['status'],
    objectiveSentence: comparable
      ? describeObjective({
          monthlyGoalCents: profile.monthlyGoalCents,
          priceCents: row.recommendedPriceCents,
          interval,
          currency: row.currency,
        })
      : MIXED_CURRENCY_NOTICE,
    validation: (row.validation as IdeaValidation | null) ?? null,
    specSheet: (row.specSheet as SpecSheet | null) ?? null,
    projectId: row.project?.id ?? null,
  }
}

/** Propose de nouvelles idées à partir du profil, et les enregistre pour comparaison. */
export async function proposeIdeas(
  userId: string,
  locale: string,
): Promise<{ ideas: ScoredIdea[]; creditsSpent: number }> {
  const profile = await requireProfile(userId)

  if (!isAiAvailable()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      "La recherche d'idées a besoin du copilote, qui n'est pas configuré sur cette installation.",
    )
  }

  const result = await suggestIdeas(userId, toAssistantProfile(profile), locale)

  const rows = result.value.ideas.map((idea: IdeaSuggestion) => ({
    userId,
    title: idea.title,
    problem: idea.problem,
    audience: idea.audience,
    valueProposition: idea.valueProposition,
    features: idea.features as unknown as Prisma.InputJsonValue,
    businessModel: idea.businessModel,
    recommendedPriceCents: idea.recommendedPriceCents,
    currency: profile.currency,
    priceInterval: idea.priceInterval,
    opportunityScore: idea.opportunityScore,
    demandLevel: idea.demandLevel,
    competitionLevel: idea.competitionLevel,
    complexityLevel: idea.complexityLevel,
    operatingCostLevel: idea.operatingCostLevel,
    timeToMarketWeeks: idea.timeToMarketWeeks,
    runningCostCents: idea.runningCostCents,
    // Calcul de la plateforme, jamais du modèle.
    customersNeeded:
      customersNeededFor(
        profile.monthlyGoalCents,
        idea.recommendedPriceCents,
        idea.priceInterval,
      ) ?? 0,
    risks: idea.risks as unknown as Prisma.InputJsonValue,
    differentiators: idea.differentiators as unknown as Prisma.InputJsonValue,
  }))

  const created = await withUserScope(userId, async (tx) => {
    await tx.idea.createMany({ data: rows })
    // Trié par score : la meilleure proposition doit arriver en tête, pas par hasard.
    return tx.idea.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { opportunityScore: 'desc' }],
      take: rows.length,
      include: { project: { select: { id: true } } },
    })
  })

  logger.info('idées proposées', { userId, count: created.length })
  return {
    ideas: created
      .map((row) => present(row, profile))
      .sort((a, b) => b.opportunityScore - a.opportunityScore),
    creditsSpent: result.creditsSpent,
  }
}

export async function listIdeas(userId: string): Promise<ScoredIdea[]> {
  const profile = await requireProfile(userId)
  const rows = await withUserScope(userId, (tx) =>
    tx.idea.findMany({
      // Les opportunités du Radar ont leur propre écran ; ici, le parcours seulement.
      where: { userId, source: 'parcours', status: { not: 'DISCARDED' } },
      orderBy: [{ status: 'asc' }, { opportunityScore: 'desc' }],
      take: 40,
      include: { project: { select: { id: true } } },
    }),
  )
  return rows.map((row) => present(row, profile))
}

export async function getIdea(userId: string, ideaId: string): Promise<ScoredIdea> {
  const profile = await requireProfile(userId)
  const row = await withUserScope(userId, (tx) =>
    tx.idea.findFirst({
      where: { id: ideaId, userId },
      include: { project: { select: { id: true } } },
    }),
  )
  if (row === null) throw notFound('Cette idée est introuvable.')
  return present(row, profile)
}

/**
 * Examen approfondi avant construction.
 *
 * Le prix recommandé par la validation remplace celui de la proposition initiale : c'est
 * l'analyse la plus complète qui fait foi, et le nombre de clients est recalculé.
 */
export async function runValidation(
  userId: string,
  ideaId: string,
  locale: string,
): Promise<{ idea: ScoredIdea; creditsSpent: number }> {
  const profile = await requireProfile(userId)
  const current = await getIdea(userId, ideaId)

  if (!isAiAvailable()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      "L'analyse a besoin du copilote, qui n'est pas configuré sur cette installation.",
    )
  }

  const result = await validateIdea(
    userId,
    {
      title: current.title,
      problem: current.problem,
      audience: current.audience,
      valueProposition: current.valueProposition,
      features: current.features,
      businessModel: current.businessModel,
      recommendedPriceCents: current.recommendedPriceCents,
      priceInterval: current.priceInterval,
    },
    toAssistantProfile(profile),
    locale,
  )
  const validation = result.value

  const updated = await withUserScope(userId, (tx) =>
    tx.idea.update({
      where: { id: ideaId },
      data: {
        validation: validation as unknown as Prisma.InputJsonValue,
        validatedAt: new Date(),
        opportunityScore: validation.opportunityScore,
        demandLevel: validation.demandLevel,
        competitionLevel: validation.competitionLevel,
        complexityLevel: validation.complexityLevel,
        operatingCostLevel: validation.operatingCostLevel,
        businessModel: validation.businessModel,
        recommendedPriceCents: validation.recommendedPriceCents,
        priceInterval: validation.priceInterval,
        customersNeeded:
          customersNeededFor(
            profile.monthlyGoalCents,
            validation.recommendedPriceCents,
            validation.priceInterval,
          ) ?? 0,
      },
      include: { project: { select: { id: true } } },
    }),
  )

  return {
    idea: present(updated, profile),
    creditsSpent: result.creditsSpent,
  }
}

/**
 * Étape 5 du parcours : le cahier des charges.
 *
 * Produit une fois, puis conservé. Le régénérer à chaque visite coûterait des crédits et
 * changerait un document que le créateur a peut-être déjà lu et approuvé.
 */
export async function buildSpecSheet(
  userId: string,
  ideaId: string,
  locale: string,
): Promise<{ idea: ScoredIdea; creditsSpent: number }> {
  const profile = await requireProfile(userId)
  const current = await getIdea(userId, ideaId)

  if (current.specSheet !== null) return { idea: current, creditsSpent: 0 }

  if (!isAiAvailable()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      "La rédaction du cahier des charges a besoin du copilote, qui n'est pas configuré sur cette installation.",
    )
  }

  const result = await writeSpecSheet(
    userId,
    {
      title: current.title,
      problem: current.problem,
      audience: current.audience,
      valueProposition: current.valueProposition,
      features: current.features,
      businessModel: current.businessModel,
      recommendedPriceCents: current.recommendedPriceCents,
      priceInterval: current.priceInterval,
      differentiators: current.differentiators,
    },
    current.validation,
    toAssistantProfile(profile),
    locale,
  )

  const updated = await withUserScope(userId, (tx) =>
    tx.idea.update({
      where: { id: ideaId },
      data: {
        specSheet: result.value as unknown as Prisma.InputJsonValue,
        specSheetAt: new Date(),
        runningCostCents: result.value.runningCostCents,
      },
      include: { project: { select: { id: true } } },
    }),
  )

  logger.info('cahier des charges rédigé', { userId, ideaId })
  return { idea: present(updated, profile), creditsSpent: result.creditsSpent }
}

export async function discardIdea(userId: string, ideaId: string): Promise<void> {
  await withUserScope(userId, async (tx) => {
    const updated = await tx.idea.updateMany({
      where: { id: ideaId, userId },
      data: { status: 'DISCARDED' },
    })
    if (updated.count === 0) throw notFound('Cette idée est introuvable.')
  })
}
