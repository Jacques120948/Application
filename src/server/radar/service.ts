import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { AppError, notFound, validation } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { isAiAvailable } from '@/server/ai/client'
import { compareOpportunities, runRadar as askRadar } from '@/server/ai/operations'
import type { RadarComparison, RadarSuggestion } from '@/server/ai/schemas'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { customersNeededFor } from '@/server/business/economics'
import { isEnabled } from '@/server/settings/flags'
import { fingerprint, looksAlike, opportunityScore, profileFit, subScores, type SubScores } from './score'
import { missingPrecisions, readRadarProfile, toRadarProfile, type ProfileRow } from './profile'
import { readPreferenceHints } from './preferences'
import { collectSignals, describeSignals } from './signals'
import { assertRadarQuota, radarQuota, type QuotaState } from './quota'

/**
 * Le Radar d'opportunités.
 *
 * Il ne remplace pas la recherche d'idées : il la prolonge. Une opportunité *est* une idée,
 * rangée dans la même table, ouverte par la même fiche d'étude, transformée en projet par
 * le même chemin. Ce que le Radar ajoute tient en quatre mots : expliquer, ne pas répéter,
 * borner, retenir.
 *
 * Expliquer : chaque opportunité porte les raisons de sa proposition, et son score se lit en
 * cinq composantes calculées ici, pas par le modèle. Ne pas répéter : les titres déjà vus
 * sont transmis au modèle, et une empreinte lexicale écarte ce qu'il aurait reformulé sans
 * le savoir. Borner : un quota mensuel par offre, vérifié avant tout appel. Retenir : une
 * opportunité se garde, se rejette avec une raison, s'archive, et tout cela est relu par
 * la recherche suivante.
 *
 * Ce que le Radar ne fait jamais : présenter une estimation comme un fait. Le « pourquoi
 * maintenant » est une interprétation tant qu'aucun signal observé ne l'étaie, et l'écran
 * le dit.
 */

export const RADAR_FEATURE = 'radar'

/** Coût annoncé avant une recherche. Plancher de l'opération ; le réel suit les jetons. */
export const RADAR_ESTIMATED_CREDITS = 3
export const COMPARE_ESTIMATED_CREDITS = 2

export const OPPORTUNITY_STATUSES = ['PROPOSED', 'SAVED', 'SELECTED', 'DISCARDED', 'ARCHIVED'] as const
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]

export const REJECT_REASONS = [
  'too_complex',
  'not_my_sector',
  'too_competitive',
  'too_expensive',
  'no_b2b',
  'other',
] as const

export const statusInput = z.object({
  ideaId: z.string().uuid(),
  status: z.enum(['SAVED', 'DISCARDED', 'ARCHIVED', 'PROPOSED']),
  reason: z.enum(REJECT_REASONS).optional(),
})

export const feedbackInput = z.object({
  ideaId: z.string().uuid(),
  verdict: z.enum(['interested', 'not_for_me']),
  reason: z.enum(REJECT_REASONS).optional(),
})

export const compareInput = z.object({
  ideaIds: z.array(z.string().uuid()).min(2).max(3),
})

/** Une opportunité, telle que l'écran la reçoit. */
export type Opportunity = {
  id: string
  runId: string | null
  source: string
  title: string
  problem: string
  audience: string
  valueProposition: string
  features: string[]
  businessModel: string
  recommendedPriceCents: number
  priceInterval: string
  currency: string
  opportunityScore: number
  subScores: SubScores | null
  fitReasons: string[]
  whyNow: string | null
  keyAdvantage: string | null
  mainRisk: string | null
  validationQuestions: string[]
  demandLevel: string
  competitionLevel: string
  complexityLevel: string
  operatingCostLevel: string
  timeToMarketWeeks: number
  runningCostCents: number
  customersNeeded: number
  risks: string[]
  differentiators: string[]
  status: OpportunityStatus
  rejectReason: string | null
  /** Vrai quand la fiche d'étude a produit son analyse. */
  analyzed: boolean
  projectId: string | null
  createdAt: string
}

export type RadarOverview = {
  quota: QuotaState
  /** Précisions du profil encore vides, pour proposer d'affiner. */
  missingPrecisions: string[]
  aiAvailable: boolean
  opportunities: Opportunity[]
  runs: Array<{ id: string; createdAt: string; ideaCount: number; creditsSpent: number; trigger: string }>
}

function asStrings(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Le contenu Radar d'une idée est rangé dans deux colonnes JSON : `fitReasons` et
 * `subScores`. Le reste — pourquoi maintenant, avantage, risque, questions — vit dans
 * `fitReasons` sous forme d'objet, pour ne pas ajouter six colonnes à une table partagée
 * avec le parcours classique.
 */
type RadarExtras = {
  reasons: string[]
  whyNow: string | null
  keyAdvantage: string | null
  mainRisk: string | null
  validationQuestions: string[]
}

function readExtras(value: Prisma.JsonValue | null): RadarExtras {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { reasons: [], whyNow: null, keyAdvantage: null, mainRisk: null, validationQuestions: [] }
  }
  const objet = value as Record<string, unknown>
  return {
    reasons: asStrings(objet.reasons as Prisma.JsonValue),
    whyNow: typeof objet.whyNow === 'string' ? objet.whyNow : null,
    keyAdvantage: typeof objet.keyAdvantage === 'string' ? objet.keyAdvantage : null,
    mainRisk: typeof objet.mainRisk === 'string' ? objet.mainRisk : null,
    validationQuestions: asStrings(objet.validationQuestions as Prisma.JsonValue),
  }
}

function readSubScores(value: Prisma.JsonValue | null): SubScores | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const objet = value as Record<string, unknown>
  const cles = ['profileFit', 'demand', 'monetization', 'competition', 'complexity'] as const
  if (!cles.every((cle) => typeof objet[cle] === 'number')) return null
  return {
    profileFit: objet.profileFit as number,
    demand: objet.demand as number,
    monetization: objet.monetization as number,
    competition: objet.competition as number,
    complexity: objet.complexity as number,
  }
}

type IdeaRow = {
  id: string
  runId: string | null
  source: string
  title: string
  problem: string
  audience: string
  valueProposition: string
  features: Prisma.JsonValue
  businessModel: string
  recommendedPriceCents: number
  priceInterval: string
  currency: string
  opportunityScore: number
  subScores: Prisma.JsonValue | null
  fitReasons: Prisma.JsonValue | null
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
  rejectReason: string | null
  validatedAt: Date | null
  createdAt: Date
  project?: { id: string } | null
}

const IDEA_SELECT = {
  id: true,
  runId: true,
  source: true,
  title: true,
  problem: true,
  audience: true,
  valueProposition: true,
  features: true,
  businessModel: true,
  recommendedPriceCents: true,
  priceInterval: true,
  currency: true,
  opportunityScore: true,
  subScores: true,
  fitReasons: true,
  demandLevel: true,
  competitionLevel: true,
  complexityLevel: true,
  operatingCostLevel: true,
  timeToMarketWeeks: true,
  runningCostCents: true,
  customersNeeded: true,
  risks: true,
  differentiators: true,
  status: true,
  rejectReason: true,
  validatedAt: true,
  createdAt: true,
  project: { select: { id: true } },
} satisfies Prisma.IdeaSelect

function toOpportunity(row: IdeaRow): Opportunity {
  const extras = readExtras(row.fitReasons)
  return {
    id: row.id,
    runId: row.runId,
    source: row.source,
    title: row.title,
    problem: row.problem,
    audience: row.audience,
    valueProposition: row.valueProposition,
    features: asStrings(row.features),
    businessModel: row.businessModel,
    recommendedPriceCents: row.recommendedPriceCents,
    priceInterval: row.priceInterval,
    currency: row.currency,
    opportunityScore: row.opportunityScore,
    subScores: readSubScores(row.subScores),
    fitReasons: extras.reasons,
    whyNow: extras.whyNow,
    keyAdvantage: extras.keyAdvantage,
    mainRisk: extras.mainRisk,
    validationQuestions: extras.validationQuestions,
    demandLevel: row.demandLevel,
    competitionLevel: row.competitionLevel,
    complexityLevel: row.complexityLevel,
    operatingCostLevel: row.operatingCostLevel,
    timeToMarketWeeks: row.timeToMarketWeeks,
    runningCostCents: row.runningCostCents,
    customersNeeded: row.customersNeeded,
    risks: asStrings(row.risks),
    differentiators: asStrings(row.differentiators),
    status: row.status as OpportunityStatus,
    rejectReason: row.rejectReason,
    analyzed: row.validatedAt !== null,
    projectId: row.project?.id ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Les droits d'abord, l'interrupteur ensuite : un module coupé l'est pour tout le monde. */
async function assertRadarOpen(userId: string): Promise<void> {
  if (!(await isEnabled('radar'))) {
    throw new AppError('UNSUPPORTED_REQUEST', "Le Radar n'est pas ouvert sur cette installation.")
  }
  requireFeature(await getEntitlements(userId), RADAR_FEATURE)
}

/**
 * Le nombre d'opportunités pas encore regardées, pour le tableau de bord.
 *
 * Renvoie `null` quand le Radar n'est pas ouvert à cette personne : le tableau de bord
 * n'a alors rien à afficher, et surtout rien à promettre.
 */
export async function countNewOpportunities(userId: string): Promise<number | null> {
  if (!(await isEnabled('radar'))) return null
  const entitlements = await getEntitlements(userId)
  if (!entitlements.granted.includes(RADAR_FEATURE)) return null
  return withUserScope(userId, (tx) =>
    tx.idea.count({ where: { userId, source: { in: ['radar', 'radar_projet'] }, status: 'PROPOSED' } }),
  )
}

/** L'écran du Radar, sans appel au modèle. */
export async function getRadarOverview(userId: string): Promise<RadarOverview> {
  await assertRadarOpen(userId)
  const profile = await readRadarProfile(userId)

  const [quota, rows, runs] = await Promise.all([
    radarQuota(userId),
    withUserScope(userId, (tx) =>
      tx.idea.findMany({
        where: { userId, source: { in: ['radar', 'radar_projet'] } },
        orderBy: [{ createdAt: 'desc' }, { opportunityScore: 'desc' }],
        take: 60,
        select: IDEA_SELECT,
      }),
    ),
    withUserScope(userId, (tx) =>
      tx.radarRun.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, createdAt: true, ideaCount: true, creditsSpent: true, trigger: true },
      }),
    ),
  ])

  return {
    quota,
    missingPrecisions: missingPrecisions(profile),
    aiAvailable: isAiAvailable(),
    opportunities: rows.map(toOpportunity),
    runs: runs.map((run) => ({ ...run, createdAt: run.createdAt.toISOString() })),
  }
}

/**
 * Une recherche.
 *
 * L'ordre est celui de toutes les opérations payantes : droits, quota, solde (dans
 * l'opération), appel, puis seulement l'écriture. Un modèle en panne ne coûte rien et ne
 * consomme pas de recherche.
 *
 * `trigger` distingue une recherche demandée d'une recherche périodique (V2) : la seconde
 * n'écrit rien quand elle ne trouve rien de nouveau, et prévient quand elle trouve.
 */
export type RadarTrigger = 'manual' | 'scheduled' | 'project'

export async function runRadar(
  userId: string,
  locale: string,
  trigger: RadarTrigger = 'manual',
  options: { projectId?: string } = {},
): Promise<{ opportunities: Opportunity[]; creditsSpent: number; quota: QuotaState; skipped: number }> {
  await assertRadarOpen(userId)
  if (!isAiAvailable()) {
    throw new AppError('AI_UNAVAILABLE', "Le Radar a besoin du copilote, qui n'est pas configuré ici.")
  }
  // Tout ce qui suit la V1 est derrière le second drapeau : une recherche autour d'un
  // projet, les indices tirés des avis, les signaux extérieurs.
  const v2 = await isEnabled('radarV2')
  if (trigger === 'project' && !v2) {
    throw new AppError('UNSUPPORTED_REQUEST', "La recherche autour d'un projet n'est pas encore ouverte.")
  }
  const profile = await readRadarProfile(userId)

  // Le projet avant le quota : un projet qui n'existe pas n'est pas une recherche.
  const project =
    trigger === 'project'
      ? await withUserScope(userId, (tx) =>
          tx.project.findFirst({
            where: { id: options.projectId ?? '', ownerId: userId, deletedAt: null },
            select: { id: true, name: true, idea: true, draftSpec: true },
          }),
        )
      : null
  if (trigger === 'project' && project === null) throw notFound("Ce projet n'existe pas.")
  await assertRadarQuota(userId)

  const [hints, signals] = v2
    ? await Promise.all([
        readPreferenceHints(userId),
        collectSignals(userId, {
          topic: project?.name ?? `${profile.sector} ${profile.interests}`.trim(),
          locale,
          scope: profile.marketScope,
        }),
      ])
    : [[], []]

  // Ce qu'elle a déjà vu : titres transmis au modèle, empreintes gardées pour le filet.
  const vues = await withUserScope(userId, (tx) =>
    tx.idea.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: { title: true, fingerprint: true, problem: true },
    }),
  )
  const empreintesVues = vues.map((idee) => idee.fingerprint ?? fingerprint(idee.title, idee.problem))

  const spec = project?.draftSpec as { description?: unknown } | null
  const result = await askRadar(userId, toRadarProfile(profile), vues.map((idee) => idee.title), locale, {
    hints,
    signals: describeSignals(signals),
    project:
      project === null
        ? null
        : {
            name: project.name,
            idea: project.idea,
            description: typeof spec?.description === 'string' ? spec.description : '',
          },
  })

  // Filet lexical : ce que le modèle a reformulé sans le savoir est écarté ici.
  const retenues: RadarSuggestion[] = []
  const empreintesRetenues: string[] = []
  let ecartees = 0
  for (const suggestion of result.value.opportunities) {
    const empreinte = fingerprint(suggestion.title, suggestion.problem)
    const doublon =
      empreintesVues.some((vue) => looksAlike(vue, empreinte)) ||
      empreintesRetenues.some((vue) => looksAlike(vue, empreinte))
    if (doublon) {
      ecartees += 1
      continue
    }
    retenues.push(suggestion)
    empreintesRetenues.push(empreinte)
  }

  const run = await withUserScope(userId, (tx) =>
    tx.radarRun.create({
      data: {
        userId,
        trigger,
        projectId: project?.id ?? null,
        profileSnapshot: toRadarProfile(profile) as unknown as Prisma.InputJsonValue,
        ideaCount: retenues.length,
        creditsSpent: result.creditsSpent,
      },
      select: { id: true },
    }),
  )

  const rows = retenues.map((s) => {
    const fit = profileFit({ profile, idea: s })
    const scores = subScores({
      profileFit: fit,
      demandLevel: s.demandLevel,
      monetizationLevel: s.monetizationLevel,
      competitionLevel: s.competitionLevel,
      complexityLevel: s.complexityLevel,
    })
    const extras: RadarExtras = {
      reasons: s.whyYou,
      whyNow: s.whyNow,
      keyAdvantage: s.keyAdvantage,
      mainRisk: s.mainRisk,
      validationQuestions: s.validationQuestions,
    }
    return {
      userId,
      source: trigger === 'project' ? 'radar_projet' : 'radar',
      runId: run.id,
      title: s.title,
      problem: s.problem,
      audience: s.audience,
      valueProposition: s.valueProposition,
      features: s.features as unknown as Prisma.InputJsonValue,
      businessModel: s.businessModel,
      recommendedPriceCents: s.recommendedPriceCents,
      currency: profile.currency,
      priceInterval: s.priceInterval,
      opportunityScore: opportunityScore(scores),
      subScores: scores as unknown as Prisma.InputJsonValue,
      fitReasons: extras as unknown as Prisma.InputJsonValue,
      fingerprint: fingerprint(s.title, s.problem),
      demandLevel: s.demandLevel,
      competitionLevel: s.competitionLevel,
      complexityLevel: s.complexityLevel,
      operatingCostLevel: s.operatingCostLevel,
      timeToMarketWeeks: s.timeToMarketWeeks,
      runningCostCents: s.runningCostCents,
      // Calcul de la plateforme, jamais du modèle.
      customersNeeded:
        customersNeededFor(profile.monthlyGoalCents, s.recommendedPriceCents, s.priceInterval) ?? 0,
      risks: s.risks as unknown as Prisma.InputJsonValue,
      differentiators: s.differentiators as unknown as Prisma.InputJsonValue,
    }
  })

  const created = await withUserScope(userId, async (tx) => {
    if (rows.length > 0) await tx.idea.createMany({ data: rows })
    return tx.idea.findMany({
      where: { userId, runId: run.id },
      orderBy: { opportunityScore: 'desc' },
      select: IDEA_SELECT,
    })
  })

  logger.info('radar : recherche effectuée', {
    userId,
    runId: run.id,
    trigger,
    proposed: result.value.opportunities.length,
    kept: created.length,
    skipped: ecartees,
    credits: result.creditsSpent,
  })

  return {
    opportunities: created.map(toOpportunity),
    creditsSpent: result.creditsSpent,
    quota: await radarQuota(userId),
    skipped: ecartees,
  }
}

/** Enregistrer, rejeter avec une raison, archiver, ou remettre en vue. */
export async function setOpportunityStatus(
  userId: string,
  input: z.infer<typeof statusInput>,
): Promise<Opportunity> {
  // Une raison de rejet est facultative pour la personne ; « autre » sinon.
  const now = new Date()
  const data: Prisma.IdeaUpdateManyMutationInput = {
    status: input.status,
    savedAt: input.status === 'SAVED' ? now : null,
    archivedAt: input.status === 'ARCHIVED' ? now : null,
    rejectReason: input.status === 'DISCARDED' ? (input.reason ?? 'other') : null,
  }
  const updated = await withUserScope(userId, async (tx) => {
    const found = await tx.idea.findFirst({
      where: { id: input.ideaId, userId, source: { in: ['radar', 'radar_projet'] } },
      select: { id: true, status: true },
    })
    if (found === null) return null
    // Une opportunité devenue projet ne change plus de statut : le projet fait foi.
    if (found.status === 'SELECTED') {
      throw validation('Cette opportunité est déjà devenue un projet.')
    }
    await tx.idea.update({ where: { id: found.id }, data })
    return tx.idea.findUniqueOrThrow({ where: { id: found.id }, select: IDEA_SELECT })
  })
  if (updated === null) throw notFound("Cette opportunité n'existe pas.")

  logger.info('radar : statut modifié', { userId, ideaId: input.ideaId, status: input.status })
  return toOpportunity(updated)
}

/** « Ça m'intéresse » / « Pas pour moi ». Un avis par opportunité, remplaçable. */
export async function recordFeedback(
  userId: string,
  input: z.infer<typeof feedbackInput>,
): Promise<void> {
  await withUserScope(userId, async (tx) => {
    const found = await tx.idea.findFirst({ where: { id: input.ideaId, userId }, select: { id: true } })
    if (found === null) throw notFound("Cette opportunité n'existe pas.")
    await tx.radarFeedback.upsert({
      where: { userId_ideaId: { userId, ideaId: input.ideaId } },
      create: { userId, ideaId: input.ideaId, verdict: input.verdict, reason: input.reason ?? null },
      update: { verdict: input.verdict, reason: input.reason ?? null },
    })
  })
}

export type ComparisonView = {
  opportunities: Opportunity[]
  synthesis: RadarComparison
  creditsSpent: number
}

/**
 * Comparer deux ou trois opportunités.
 *
 * Le tableau est calculé ici depuis les colonnes ; seule la synthèse appelle le modèle, et
 * elle conclut par priorité, jamais par un classement. Une comparaison ne consomme pas une
 * recherche du quota : elle relit ce qui existe.
 */
export async function compare(
  userId: string,
  input: z.infer<typeof compareInput>,
  locale: string,
): Promise<ComparisonView> {
  await assertRadarOpen(userId)
  const profile = await readRadarProfile(userId)
  const rows = await withUserScope(userId, (tx) =>
    tx.idea.findMany({ where: { userId, id: { in: input.ideaIds } }, select: IDEA_SELECT }),
  )
  if (rows.length !== input.ideaIds.length) throw notFound("Une de ces opportunités n'existe pas.")
  const opportunities = rows.map(toOpportunity)

  const result = await compareOpportunities(
    userId,
    toRadarProfile(profile),
    opportunities.map((o) => ({
      title: o.title,
      problem: o.problem,
      audience: o.audience,
      businessModel: o.businessModel,
      priceCents: o.recommendedPriceCents,
      priceInterval: o.priceInterval,
      score: o.opportunityScore,
      subScores: o.subScores,
      timeToMarketWeeks: o.timeToMarketWeeks,
      runningCostCents: o.runningCostCents,
      competitionLevel: o.competitionLevel,
      complexityLevel: o.complexityLevel,
      mainRisk: o.mainRisk,
    })),
    locale,
  )

  return { opportunities, synthesis: result.value, creditsSpent: result.creditsSpent }
}

export { type ProfileRow }

/** Recevoir ou non la recherche mensuelle automatique et son avis (V2). */
export async function setRadarAlerts(userId: string, enabled: boolean): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { radarAlerts: enabled } })
}

export async function readRadarAlerts(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { radarAlerts: true } })
  return user?.radarAlerts ?? false
}
