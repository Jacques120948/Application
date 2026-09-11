import { withUserScope } from '@/server/db/scope'
import { parseAppSpec } from '@/server/spec/validate'
import { runChecks } from '@/server/spec/checks'
import { computeJourney, type Journey } from './journey'
import { customersNeededFor, describeObjective, formatAmount, type PriceInterval } from './economics'

/**
 * Vue d'ensemble du créateur, telle qu'elle apparaît sur le tableau de bord.
 *
 * Répond aux trois questions de l'exigence 14 : où j'en suis, ce que je dois faire
 * ensuite, et pourquoi. Tout est dérivé de l'état réel, rien n'est stocké en double.
 */

export type CreatorOverview = {
  journey: Journey
  objective: {
    monthlyGoalLabel: string
    /** Idée retenue, si une a été choisie. */
    ideaTitle: string | null
    opportunityScore: number | null
    priceLabel: string | null
    customersNeeded: number | null
    sentence: string | null
  } | null
  ideaCount: number
  projectCount: number
  currentProjectId: string | null
}

export async function getCreatorOverview(
  userId: string,
  locale: string,
): Promise<CreatorOverview> {
  const data = await withUserScope(userId, async (tx) => {
    const profile = await tx.creatorProfile.findUnique({ where: { userId } })
    const ideas = await tx.idea.findMany({
      where: { userId, status: { not: 'DISCARDED' } },
      orderBy: [{ status: 'asc' }, { opportunityScore: 'desc' }],
      take: 20,
    })
    const projects = await tx.project.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    })
    return { profile, ideas, projects }
  })

  const current = data.projects[0] ?? null
  // « Mon projet » n'affiche une idée que lorsqu'elle a été retenue ou au moins analysée.
  // Montrer la mieux notée d'une liste de propositions laisserait croire qu'un choix a
  // été fait alors que non.
  const selectedIdea =
    data.ideas.find((idea) => idea.status === 'SELECTED') ??
    data.ideas
      .filter((idea) => idea.validatedAt !== null)
      .sort((a, b) => b.validatedAt!.getTime() - a.validatedAt!.getTime())[0] ??
    null

  let testedWithoutError = false
  let monetizationDecided = false
  if (current !== null) {
    try {
      const spec = parseAppSpec(current.draftSpec)
      const report = runChecks(spec)
      testedWithoutError = current.lastCheckScore !== null && report.counts.error === 0
      monetizationDecided =
        spec.monetization.model === 'free'
          ? current.publishedAt !== null
          : spec.monetization.plans.length > 0
    } catch {
      // Une spécification illisible ne doit pas empêcher d'afficher le parcours.
      testedWithoutError = false
    }
  }

  const journey = computeJourney({
    locale,
    hasProfile: data.profile !== null && data.profile.completedAt !== null,
    guidedPath: data.ideas.length > 0,
    hasIdea: data.ideas.some((idea) => idea.status === 'SELECTED') || data.projects.length > 0,
    ideaValidated: data.ideas.some((idea) => idea.validatedAt !== null),
    specSheetReady: data.ideas.some((idea) => idea.specSheetAt !== null),
    projectId: current?.id ?? null,
    hasBuild: data.projects.length > 0,
    testedWithoutError,
    monetizationDecided,
    published: current?.publishedAt !== null && current !== null,
  })

  const objective =
    data.profile === null
      ? null
      : {
          monthlyGoalLabel: `${formatAmount(data.profile.monthlyGoalCents)} par mois`,
          ideaTitle: selectedIdea?.title ?? null,
          opportunityScore: selectedIdea?.opportunityScore ?? null,
          priceLabel:
            selectedIdea === null
              ? null
              : formatAmount(selectedIdea.recommendedPriceCents),
          customersNeeded:
            selectedIdea === null
              ? null
              : customersNeededFor(
                  data.profile.monthlyGoalCents,
                  selectedIdea.recommendedPriceCents,
                  selectedIdea.priceInterval as PriceInterval,
                ),
          sentence:
            selectedIdea === null
              ? null
              : describeObjective({
                  monthlyGoalCents: data.profile.monthlyGoalCents,
                  priceCents: selectedIdea.recommendedPriceCents,
                  interval: selectedIdea.priceInterval as PriceInterval,
                }),
        }

  return {
    journey,
    objective,
    ideaCount: data.ideas.length,
    projectCount: data.projects.length,
    currentProjectId: current?.id ?? null,
  }
}
