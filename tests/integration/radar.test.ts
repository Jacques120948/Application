import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { saveProfile } from '@/server/business/profile'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { AppError } from '@/lib/errors'
import type { RadarSuggestion } from '@/server/ai/schemas'
import { improveProfile, missingPrecisions, readRadarProfile } from '@/server/radar/profile'
import { radarQuota } from '@/server/radar/quota'
import {
  compare,
  getRadarOverview,
  recordFeedback,
  runRadar,
  setOpportunityStatus,
} from '@/server/radar/service'
import * as operations from '@/server/ai/operations'

/**
 * Le Radar de bout en bout, sans appel réel au modèle.
 *
 * Les deux opérations du modèle sont remplacées ; tout le reste est le vrai chemin : le
 * drapeau, l'offre, le quota, la déduplication, le score calculé par la plateforme, les
 * statuts, les avis, la comparaison — et le cloisonnement entre deux personnes.
 */

vi.mock('@/server/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/client')>()),
  isAiAvailable: () => true,
}))

vi.mock('@/server/ai/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/operations')>()),
  runRadar: vi.fn(),
  compareOpportunities: vi.fn(),
}))

const askRadar = vi.mocked(operations.runRadar)
const askComparison = vi.mocked(operations.compareOpportunities)

const SUGGESTIONS: RadarSuggestion[] = [
  {
    title: 'Planning en ligne pour salons de coiffure',
    problem: 'Les salons perdent des rendez-vous faute de prise de réservation en dehors des heures.',
    audience: 'Salons de coiffure indépendants',
    valueProposition: 'Réservation en ligne 24 h/24 avec rappels automatiques.',
    features: ['Agenda en ligne', 'Rappels SMS', 'Fiches clientes'],
    businessModel: 'subscription',
    recommendedPriceCents: 2_900,
    priceInterval: 'month',
    demandLevel: 'fort',
    monetizationLevel: 'fort',
    competitionLevel: 'moyen',
    complexityLevel: 'faible',
    operatingCostLevel: 'faible',
    timeToMarketWeeks: 3,
    runningCostCents: 1_500,
    risks: ['Des concurrents installés'],
    differentiators: ['Pensé pour un salon seul'],
    whyYou: ['Vous connaissez la coiffure', 'Vous gérez déjà des plannings'],
    whyNow: 'Les clientes réservent de plus en plus depuis leur téléphone.',
    keyAdvantage: 'Une mise en place en une soirée.',
    mainRisk: 'Convaincre les salons de changer d’habitude.',
    validationQuestions: ['Combien de rendez-vous perdez-vous par semaine ?', 'Que payez-vous aujourd’hui ?'],
  },
  {
    title: 'Fiches de suivi pour esthéticiennes à domicile',
    problem: 'Les esthéticiennes itinérantes notent leurs soins sur papier et perdent l’historique.',
    audience: 'Esthéticiennes à domicile',
    valueProposition: 'Un carnet de soins numérique, consultable en déplacement.',
    features: ['Historique par cliente', 'Photos avant/après', 'Relances'],
    businessModel: 'subscription',
    recommendedPriceCents: 1_500,
    priceInterval: 'month',
    demandLevel: 'moyen',
    monetizationLevel: 'moyen',
    competitionLevel: 'faible',
    complexityLevel: 'faible',
    operatingCostLevel: 'faible',
    timeToMarketWeeks: 2,
    runningCostCents: 800,
    risks: ['Marché diffus'],
    differentiators: ['Hors ligne'],
    whyYou: ['Vous venez du secteur de la beauté', 'Vous savez ce qu’une cliente attend'],
    whyNow: 'Le métier se développe hors des instituts.',
    keyAdvantage: 'Aucun équivalent simple en français.',
    mainRisk: 'Des professionnelles peu nombreuses par ville.',
    validationQuestions: ['Comment suivez-vous vos clientes aujourd’hui ?', 'Combien paieriez-vous ?'],
  },
]

let userA: string
let userB: string

async function creerPersonne(): Promise<string> {
  const account = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  await saveProfile(account.userId, {
    monthlyGoalCents: 100_000,
    weeklyHours: 6,
    budgetCents: 5_000,
    currency: 'CHF',
    country: 'Suisse',
    skills: 'Coiffure, gestion de planning',
    interests: 'Artisanat local',
    sector: 'Beauté',
    audience: 'professionnels',
    ambition: 'simple',
    preferredModel: 'subscription',
  })
  return account.userId
}

const PLAN_ID = 'test-radar'

beforeAll(async () => {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  // Une offre propre à ce test, inactive donc invisible dans la liste des offres : le Radar
  // ouvert avec deux recherches par mois. Les offres partagées ne sont pas touchées, car
  // d'autres suites tournent en même temps sur la même base.
  const launch = DEFAULT_PLANS.find((plan) => plan.id === 'launch')!
  await prisma.plan.upsert({
    where: { id: PLAN_ID },
    update: { features: [...launch.features, 'radar'], radarRunsPerMonth: 2 },
    create: {
      ...launch,
      id: PLAN_ID,
      name: 'Radar (test)',
      features: [...launch.features, 'radar'],
      radarRunsPerMonth: 2,
      isActive: false,
      currency: 'EUR',
      interval: 'month',
    },
  })
  clearAll()
  userA = await creerPersonne()
  userB = await creerPersonne()
  await prisma.subscription.upsert({
    where: { userId: userA },
    create: { userId: userA, planId: PLAN_ID, status: 'ACTIVE' },
    update: { planId: PLAN_ID, status: 'ACTIVE' },
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } }).catch(() => undefined)
  await prisma.plan.delete({ where: { id: PLAN_ID } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Radar d’opportunités', () => {
  it('refuse une personne dont l’offre n’ouvre pas le Radar, sans rien charger', async () => {
    await expect(getRadarOverview(userB)).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    await expect(runRadar(userB, 'fr')).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    expect(askRadar).not.toHaveBeenCalled()
  })

  it('ne coûte ni recherche ni crédit quand le modèle échoue', async () => {
    askRadar.mockRejectedValueOnce(new AppError('AI_UNAVAILABLE', 'Panne simulée.'))
    await expect(runRadar(userA, 'fr')).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
    const runs = await withUserScope(userA, (tx) => tx.radarRun.count({ where: { userId: userA } }))
    expect(runs).toBe(0)
    expect((await radarQuota(userA)).used).toBe(0)
  })

  it('propose des opportunités notées par la plateforme, avec leurs explications', async () => {
    askRadar.mockResolvedValueOnce({
      value: { opportunities: SUGGESTIONS },
      creditsSpent: 3,
      balance: 10,
    })
    const result = await runRadar(userA, 'fr')

    expect(result.opportunities).toHaveLength(2)
    expect(result.skipped).toBe(0)
    expect(result.creditsSpent).toBe(3)
    expect(result.quota.used).toBe(1)

    // Le modèle n'a pas de mot sur la note : elle est calculée à partir des composantes.
    const [first] = askRadar.mock.calls[0] ?? []
    expect(first).toBe(userA)
    for (const o of result.opportunities) {
      expect(o.opportunityScore).toBeGreaterThanOrEqual(0)
      expect(o.opportunityScore).toBeLessThanOrEqual(100)
      expect(o.subScores).not.toBeNull()
      expect(o.fitReasons.length).toBeGreaterThanOrEqual(2)
      expect(o.validationQuestions.length).toBeGreaterThanOrEqual(2)
      expect(o.status).toBe('PROPOSED')
      expect(o.currency).toBe('CHF')
      expect(o.customersNeeded).toBeGreaterThan(0)
    }
    // Le secteur connu (beauté, coiffure) et la clientèle professionnelle sont reconnus.
    expect(result.opportunities[0]!.subScores!.profileFit).toBeGreaterThan(5.5)

    const stored = await withUserScope(userA, (tx) =>
      tx.idea.findMany({ where: { userId: userA }, select: { source: true, fingerprint: true, runId: true } }),
    )
    expect(stored.every((row) => row.source === 'radar' && row.fingerprint !== null && row.runId !== null)).toBe(true)
  })

  it('écarte ce qu’elle a déjà proposé, même reformulé', async () => {
    askRadar.mockResolvedValueOnce({
      value: {
        opportunities: [
          {
            ...SUGGESTIONS[0]!,
            title: 'Le planning en ligne des salons de coiffure',
          },
        ],
      },
      creditsSpent: 3,
      balance: 7,
    })
    const result = await runRadar(userA, 'fr')
    expect(result.opportunities).toHaveLength(0)
    expect(result.skipped).toBe(1)
    // Les titres déjà vus ont été transmis au modèle pour qu'il les évite lui-même.
    const seen = askRadar.mock.calls.at(-1)?.[2] ?? []
    expect(seen).toContain(SUGGESTIONS[0]!.title)
  })

  it('arrête au quota mensuel de l’offre, avant tout appel', async () => {
    const before = askRadar.mock.calls.length
    await expect(runRadar(userA, 'fr')).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    expect(askRadar.mock.calls.length).toBe(before)
    const overview = await getRadarOverview(userA)
    expect(overview.quota).toMatchObject({ used: 2, limit: 2, remaining: 0 })
    expect(overview.opportunities).toHaveLength(2)
    expect(overview.runs).toHaveLength(2)
  })

  it('enregistre, rejette avec une raison, archive et remet en vue', async () => {
    const overview = await getRadarOverview(userA)
    const [one, two] = overview.opportunities
    const saved = await setOpportunityStatus(userA, { ideaId: one!.id, status: 'SAVED' })
    expect(saved.status).toBe('SAVED')

    const rejected = await setOpportunityStatus(userA, {
      ideaId: two!.id,
      status: 'DISCARDED',
      reason: 'too_competitive',
    })
    expect(rejected).toMatchObject({ status: 'DISCARDED', rejectReason: 'too_competitive' })

    const archived = await setOpportunityStatus(userA, { ideaId: two!.id, status: 'ARCHIVED' })
    expect(archived).toMatchObject({ status: 'ARCHIVED', rejectReason: null })

    const back = await setOpportunityStatus(userA, { ideaId: two!.id, status: 'PROPOSED' })
    expect(back.status).toBe('PROPOSED')
  })

  it('ne laisse jamais une personne toucher aux opportunités d’une autre', async () => {
    const overview = await getRadarOverview(userA)
    const ideaId = overview.opportunities[0]!.id
    await expect(
      setOpportunityStatus(userB, { ideaId, status: 'ARCHIVED' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      recordFeedback(userB, { ideaId, verdict: 'interested' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const stillSaved = await withUserScope(userA, (tx) =>
      tx.idea.findUniqueOrThrow({ where: { id: ideaId }, select: { status: true } }),
    )
    expect(stillSaved.status).toBe('SAVED')
  })

  it('garde un avis par opportunité, remplaçable', async () => {
    const overview = await getRadarOverview(userA)
    const ideaId = overview.opportunities[0]!.id
    await recordFeedback(userA, { ideaId, verdict: 'not_for_me', reason: 'too_complex' })
    await recordFeedback(userA, { ideaId, verdict: 'interested' })
    const feedback = await withUserScope(userA, (tx) =>
      tx.radarFeedback.findMany({ where: { userId: userA, ideaId } }),
    )
    expect(feedback).toHaveLength(1)
    expect(feedback[0]).toMatchObject({ verdict: 'interested', reason: null })
  })

  it('compare deux opportunités sans consommer de recherche', async () => {
    const overview = await getRadarOverview(userA)
    const ids = overview.opportunities.map((o) => o.id)
    askComparison.mockResolvedValueOnce({
      value: {
        byPriority: [
          { priority: 'Démarrer vite', pick: SUGGESTIONS[1]!.title, because: 'Deux semaines suffisent.' },
          { priority: 'Revenu', pick: SUGGESTIONS[0]!.title, because: 'Un prix mensuel plus élevé.' },
        ],
        caution: 'Ces estimations restent à vérifier auprès de vrais salons.',
      },
      creditsSpent: 2,
      balance: 5,
    })
    const comparison = await compare(userA, { ideaIds: [ids[0]!, ids[1]!] }, 'fr')
    expect(comparison.opportunities).toHaveLength(2)
    expect(comparison.synthesis.byPriority).toHaveLength(2)
    expect((await radarQuota(userA)).used).toBe(2)

    // Les identifiants d'une autre personne ne sont pas des identifiants.
    await expect(compare(userB, { ideaIds: [ids[0]!, ids[1]!] }, 'fr')).rejects.toBeInstanceOf(AppError)
  })

  it('affine le profil sans rien redemander', async () => {
    const before = await readRadarProfile(userA)
    expect(missingPrecisions(before)).toEqual(['experienceYears', 'knownSectors', 'willingToProspect'])
    const after = await improveProfile(userA, {
      experienceYears: 8,
      knownSectors: 'Coiffure, esthétique',
      willingToProspect: false,
    })
    expect(missingPrecisions(after)).toEqual([])
    expect(after.monthlyGoalCents).toBe(100_000)
    expect(after.technicalLevel).toBe('debutant')
  })
})
