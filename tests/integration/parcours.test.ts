import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { getProfile, requireProfile, saveProfile } from '@/server/business/profile'
import { listIdeas } from '@/server/business/ideas'
import { getCreatorOverview } from '@/server/business/overview'
import { createProject } from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { AppError } from '@/lib/errors'

/**
 * Parcours recentré : objectif d'abord, idée ensuite, construction seulement après.
 * Ces tests ne passent aucun appel au copilote ; ils couvrent la mécanique.
 */

let userId: string

beforeAll(async () => {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {
        maxProjects: plan.maxProjects,
        monthlyCredits: plan.monthlyCredits,
        allowBuild: plan.allowBuild,
      },
      create: { ...plan, currency: 'EUR', interval: 'month' },
    })
  }
  clearAll()
  const account = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  userId = account.userId
}, 60_000)

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('le parcours commence par l’objectif', () => {
  it('refuse de chercher des idées tant que l’objectif n’est pas posé', async () => {
    await expect(listIdeas(userId)).rejects.toThrow(AppError)
    await expect(requireProfile(userId)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('place « définir votre objectif » comme toute première action', async () => {
    const overview = await getCreatorOverview(userId, 'fr')
    expect(overview.journey.next?.id).toBe('objectif')
    expect(overview.journey.progress).toBe(0)
    expect(overview.objective).toBeNull()
  })

  it('enregistre l’objectif et le profil', async () => {
    await saveProfile(userId, {
      monthlyGoalCents: 100_000,
      weeklyHours: 6,
      budgetCents: 5_000,
      country: 'France',
      skills: 'Coiffure, gestion de planning',
      interests: 'Artisanat local',
      sector: 'Beauté',
      audience: 'professionnels',
      ambition: 'simple',
      preferredModel: 'subscription',
    })
    const profile = await getProfile(userId)
    expect(profile?.monthlyGoalCents).toBe(100_000)
    expect(profile?.completedAt).not.toBeNull()
  })

  it('propose ensuite de choisir une idée', async () => {
    const overview = await getCreatorOverview(userId, 'fr')
    expect(overview.journey.next?.id).toBe('idee')
    expect(overview.objective?.monthlyGoalLabel).toContain('1')
    expect(overview.journey.progress).toBeGreaterThan(0)
  })
})

describe('l’offre de découverte s’arrête avant la construction', () => {
  it('refuse de construire sans abonnement, avec un message compréhensible', async () => {
    const idea = 'Un outil de devis pour les artisans du bâtiment'
    await expect(
      createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT' })

    try {
      await createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) })
    } catch (error) {
      const message = error instanceof AppError ? error.message : ''
      expect(message).toContain('formule')
      // Aucun terme technique dans un message destiné à un débutant.
      expect(message).not.toMatch(/plan_limit|quota|API|endpoint/i)
    }
  })

  it('autorise la construction une fois abonné', async () => {
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, planId: 'launch', status: 'ACTIVE' },
      update: { planId: 'launch', status: 'ACTIVE' },
    })
    const idea = 'Un outil de devis pour les artisans du bâtiment'
    const created = await createProject(userId, {
      idea,
      locale: 'fr',
      blueprint: heuristicBlueprint(idea),
    })
    expect(created.projectId).toBeTruthy()

    const overview = await getCreatorOverview(userId, 'fr')
    expect(overview.journey.steps.find((step) => step.id === 'construction')?.done).toBe(true)
    expect(overview.journey.next?.id).toBe('test')
  })

  it('fait respecter la limite de projets de l’offre', async () => {
    const idea = 'Une seconde application de test'
    await expect(
      createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
  })
})
