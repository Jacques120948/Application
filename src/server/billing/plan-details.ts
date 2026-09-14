import type { Plan } from '@prisma/client'
import { getTranslator, type Locale } from '@/i18n'
import { FEATURES, type FeatureGroup } from '@/server/billing/features'
import { IMPLEMENTED_PLAN_CAPABILITIES } from '@/server/billing/plans'

/**
 * Le contenu exact d'une offre, en toutes lettres.
 *
 * Une grille tarifaire qui dit « Builder : 3 applications » laisse deviner le reste. Ici,
 * chaque offre est décrite ligne par ligne, à partir de ce qui est réellement réglé dans
 * la table `Plan` et du catalogue des fonctions : rien n'est écrit en dur d'après le nom
 * d'une offre, et une fonction seulement prévue n'apparaît jamais — elle ne se vend pas.
 *
 * Deux formes pour la même vérité :
 *   - `planDetails` : ce que l'offre contient, groupé par thème, pour une carte ;
 *   - `comparePlans` : toutes les lignes pour toutes les offres, pour un tableau où l'on
 *     voit d'un coup d'œil ce qui change d'une offre à l'autre.
 */

export type PlanDetailGroup = { title: string; items: string[] }

export type ComparisonValue = string | boolean

export type ComparisonRow = { label: string; hint: string | null; values: ComparisonValue[] }

export type ComparisonSection = { title: string; rows: ComparisonRow[] }

export type PlanComparison = { planNames: string[]; sections: ComparisonSection[] }

/** Espace d'images en toutes lettres, arrondi : « 250 Mo » se retient, « 250.0 Mo » non. */
export function storageLabel(bytes: number): string {
  const megabytes = Math.round(bytes / (1024 * 1024))
  return megabytes >= 1024 ? `${Math.round(megabytes / 1024)} Go` : `${megabytes} Mo`
}

const GROUP_TITLES: Record<FeatureGroup, 'subscription.groupLaunch' | 'subscription.groupTeam' | 'subscription.groupRadar' | 'subscription.groupSupport'> = {
  social: 'subscription.groupLaunch',
  equipe: 'subscription.groupTeam',
  radar: 'subscription.groupRadar',
  support: 'subscription.groupSupport',
}

/** Les fonctions vendables, dans l'ordre du catalogue : construites, jamais seulement prévues. */
const LIVE_FEATURES = FEATURES.filter((feature) => feature.status === 'live')

function has(plan: Plan, featureId: string): boolean {
  return plan.features.includes(featureId)
}

function radarOpen(plan: Plan): boolean {
  return has(plan, 'radar') && plan.radarRunsPerMonth > 0
}

function liaOpen(plan: Plan): boolean {
  return has(plan, 'lia_support') && plan.liaAnswersPerMonth > 0
}

/** Ce que l'offre contient, groupé par thème. Les groupes vides sont omis. */
export function planDetails(plan: Plan, locale: Locale): PlanDetailGroup[] {
  const t = getTranslator(locale)
  const create: string[] = [
    plan.allowBuild
      ? plan.maxProjects === 1
        ? t('subscription.projectsOne')
        : t('subscription.projects', { count: plan.maxProjects })
      : t('subscription.noBuild'),
  ]
  if (plan.allowBuild) create.push(t('subscription.build'), t('subscription.install'))
  if (plan.storageBytes > 0) create.push(t('subscription.images', { size: storageLabel(plan.storageBytes) }))
  if (plan.maxConnections > 0) create.push(t('subscription.connections', { count: plan.maxConnections }))
  if (plan.allowExport && IMPLEMENTED_PLAN_CAPABILITIES.includes('allowExport')) create.push(t('subscription.export'))
  if (plan.allowMobilePrep && IMPLEMENTED_PLAN_CAPABILITIES.includes('allowMobilePrep')) {
    create.push(t('subscription.mobile'))
  }

  const groups: PlanDetailGroup[] = [
    { title: t('subscription.groupCredits'), items: [t('subscription.credits', { count: plan.monthlyCredits })] },
    { title: t('subscription.groupCreate'), items: create },
  ]

  for (const group of ['social', 'equipe', 'radar', 'support'] as const) {
    const items: string[] = []
    if (group === 'radar' && radarOpen(plan)) items.push(t('subscription.radar', { count: plan.radarRunsPerMonth }))
    if (group === 'support' && liaOpen(plan)) {
      items.push(t('subscription.lia', { count: plan.liaAnswersPerMonth }))
      if (plan.liaConversationsPerMonth > 0) {
        items.push(t('subscription.liaConversations', { count: plan.liaConversationsPerMonth }))
      }
    }
    for (const feature of LIVE_FEATURES) {
      if (feature.group !== group || feature.id === 'radar' || feature.id === 'lia_support') continue
      if (has(plan, feature.id)) items.push(feature.label)
    }
    if (items.length > 0) groups.push({ title: t(GROUP_TITLES[group]), items })
  }
  return groups
}

/** Toutes les lignes, pour toutes les offres, dans l'ordre reçu. */
export function comparePlans(plans: readonly Plan[], locale: Locale): PlanComparison {
  const t = getTranslator(locale)
  const row = (label: string, hint: string | null, value: (plan: Plan) => ComparisonValue): ComparisonRow => ({
    label,
    hint,
    values: plans.map(value),
  })

  const sections: ComparisonSection[] = [
    {
      title: t('subscription.groupCredits'),
      rows: [row(t('subscription.rowCredits'), t('subscription.creditsHint'), (plan) => String(plan.monthlyCredits))],
    },
    {
      title: t('subscription.groupCreate'),
      rows: [
        row(t('subscription.rowProjects'), null, (plan) => (plan.allowBuild ? String(plan.maxProjects) : false)),
        row(t('subscription.build'), null, (plan) => plan.allowBuild),
        row(t('subscription.install'), null, (plan) => plan.allowBuild),
        row(t('subscription.rowImages'), null, (plan) =>
          plan.storageBytes > 0 ? storageLabel(plan.storageBytes) : false,
        ),
        row(t('subscription.rowConnections'), t('subscription.connectionsHint'), (plan) =>
          plan.maxConnections > 0 ? String(plan.maxConnections) : false,
        ),
        ...(IMPLEMENTED_PLAN_CAPABILITIES.includes('allowExport')
          ? [row(t('subscription.export'), null, (plan) => plan.allowExport)]
          : []),
        ...(IMPLEMENTED_PLAN_CAPABILITIES.includes('allowMobilePrep')
          ? [row(t('subscription.mobile'), null, (plan) => plan.allowMobilePrep)]
          : []),
      ],
    },
  ]

  for (const group of ['social', 'equipe', 'radar', 'support'] as const) {
    const rows: ComparisonRow[] = []
    if (group === 'radar') {
      rows.push(
        row(t('subscription.rowRadar'), null, (plan) => (radarOpen(plan) ? String(plan.radarRunsPerMonth) : false)),
      )
    }
    if (group === 'support') {
      rows.push(
        row(t('subscription.rowLia'), null, (plan) => (liaOpen(plan) ? String(plan.liaAnswersPerMonth) : false)),
        row(t('subscription.rowLiaConversations'), null, (plan) =>
          liaOpen(plan) && plan.liaConversationsPerMonth > 0 ? String(plan.liaConversationsPerMonth) : false,
        ),
      )
    }
    for (const feature of LIVE_FEATURES) {
      if (feature.group !== group || feature.id === 'radar' || feature.id === 'lia_support') continue
      rows.push(row(feature.label, feature.summary, (plan) => has(plan, feature.id)))
    }
    if (rows.length > 0) sections.push({ title: t(GROUP_TITLES[group]), rows })
  }

  return { planNames: plans.map((plan) => plan.name), sections }
}
