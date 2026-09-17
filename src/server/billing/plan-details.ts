import type { Plan } from '@prisma/client'
import { getTranslator, type Locale } from '@/i18n'
import { FEATURES, type FeatureGroup } from '@/server/billing/features'
import { IMPLEMENTED_PLAN_CAPABILITIES } from '@/server/billing/plans'

/**
 * Le contenu exact d'une offre, en toutes lettres.
 *
 * Une grille tarifaire qui dit « Pro : 3 sites » laisse deviner le reste. Ici, chaque offre
 * est décrite ligne par ligne, à partir de ce qui est réellement réglé dans la table `Plan`
 * et du catalogue des fonctions : rien n'est écrit en dur d'après le nom d'une offre, et une
 * fonction seulement prévue n'apparaît jamais — elle ne se vend pas.
 *
 * La visibilité passe en tête, et c'est ce qui se vend : sites suivis, pages par audit,
 * audits par mois. Ce qui touche au constructeur ne s'affiche que pour une offre qui
 * l'ouvre réellement ; annoncer « s'arrête avant la construction » à quelqu'un venu faire
 * analyser son site, c'est lui parler d'un produit qu'il n'a pas demandé.
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

/**
 * Le nombre d'audits d'une offre, au bon nombre.
 *
 * « 1 audits par mois » sur l'offre d'essai est la première chose qu'on lit du produit :
 * une faute d'accord à cet endroit coûte plus cher qu'elle n'en a l'air.
 */
export function auditsLabel(plan: Pick<Plan, 'auditsPerMonth'>, locale: Locale): string {
  const t = getTranslator(locale)
  return plan.auditsPerMonth === 1
    ? t('vis.plansAuditsOne', { count: plan.auditsPerMonth })
    : t('vis.plansAudits', { count: plan.auditsPerMonth })
}

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
  /*
   * Le vocabulaire est celui de la page d'accueil, volontairement : quelqu'un qui compare
   * les offres avant de s'inscrire puis les relit dans son compte doit lire deux fois la
   * même phrase, sinon il se demande si ce sont les mêmes offres.
   */
  const visibilite: string[] = [
    plan.sitesMax === 1
      ? t('vis.plansSites', { count: plan.sitesMax })
      : t('vis.plansSitesMany', { count: plan.sitesMax }),
    t('vis.plansPages', { count: plan.pagesPerAudit }),
    auditsLabel(plan, locale),
  ]
  if (plan.allowExport && IMPLEMENTED_PLAN_CAPABILITIES.includes('allowExport')) {
    visibilite.push(t('vis.plansExport'))
  }

  const groups: PlanDetailGroup[] = [
    { title: t('subscription.groupVisibility'), items: visibilite },
    { title: t('subscription.groupCredits'), items: [t('subscription.credits', { count: plan.monthlyCredits })] },
  ]

  // Le constructeur ne s'annonce que là où il est ouvert. Ailleurs, il n'existe pas.
  if (plan.allowBuild) {
    const create: string[] = [
      plan.maxProjects === 1
        ? t('subscription.projectsOne')
        : t('subscription.projects', { count: plan.maxProjects }),
      t('subscription.build'),
      t('subscription.install'),
    ]
    if (plan.storageBytes > 0) {
      create.push(t('subscription.images', { size: storageLabel(plan.storageBytes) }))
    }
    if (plan.allowMobilePrep && IMPLEMENTED_PLAN_CAPABILITIES.includes('allowMobilePrep')) {
      create.push(t('subscription.mobile'))
    }
    groups.push({ title: t('subscription.groupCreate'), items: create })
  }

  if (plan.maxConnections > 0) {
    groups.push({
      title: t('subscription.groupConnections'),
      items: [t('subscription.connections', { count: plan.maxConnections })],
    })
  }

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
      title: t('subscription.groupVisibility'),
      rows: [
        row(t('vis.compareSites'), null, (plan) => String(plan.sitesMax)),
        row(t('vis.comparePages'), null, (plan) => String(plan.pagesPerAudit)),
        row(t('vis.compareAudits'), null, (plan) => String(plan.auditsPerMonth)),
        ...(IMPLEMENTED_PLAN_CAPABILITIES.includes('allowExport')
          ? [row(t('vis.compareExports'), null, (plan) => plan.allowExport)]
          : []),
      ],
    },
    {
      title: t('subscription.groupCredits'),
      rows: [row(t('subscription.rowCredits'), t('subscription.creditsHint'), (plan) => String(plan.monthlyCredits))],
    },
  ]

  /*
   * La section du constructeur disparaît quand aucune offre comparée ne l'ouvre : un
   * tableau de quatre lignes toutes barrées n'informe de rien et fait douter du reste.
   */
  if (plans.some((plan) => plan.allowBuild)) {
    sections.push({
      title: t('subscription.groupCreate'),
      rows: [
        row(t('subscription.rowProjects'), null, (plan) => (plan.allowBuild ? String(plan.maxProjects) : false)),
        row(t('subscription.build'), null, (plan) => plan.allowBuild),
        row(t('subscription.install'), null, (plan) => plan.allowBuild),
        row(t('subscription.rowImages'), null, (plan) =>
          plan.storageBytes > 0 ? storageLabel(plan.storageBytes) : false,
        ),
        ...(IMPLEMENTED_PLAN_CAPABILITIES.includes('allowMobilePrep')
          ? [row(t('subscription.mobile'), null, (plan) => plan.allowMobilePrep)]
          : []),
      ],
    })
  }

  if (plans.some((plan) => plan.maxConnections > 0)) {
    sections.push({
      title: t('subscription.groupConnections'),
      rows: [
        row(t('subscription.rowConnections'), t('subscription.connectionsHint'), (plan) =>
          plan.maxConnections > 0 ? String(plan.maxConnections) : false,
        ),
      ],
    })
  }

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
