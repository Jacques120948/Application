import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { getProfile, requireProfile, saveProfile } from '@/server/business/profile'
import { listIdeas } from '@/server/business/ideas'
import { getCreatorOverview } from '@/server/business/overview'
import { createProject } from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { AppError } from '@/lib/errors'
import { ensureTestPlan, TEST_PLAN_ID } from '../helpers/plan'

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
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  // L'offre technique des tests : elle ouvre tout, et ne dépend d'aucune décision commerciale.
  await ensureTestPlan()
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
      currency: 'CHF',
      country: 'Suisse',
      skills: 'Coiffure, gestion de planning',
      interests: 'Artisanat local',
      sector: 'Beauté',
      audience: 'professionnels',
      ambition: 'simple',
      preferredModel: 'subscription',
    })
    const profile = await getProfile(userId)
    expect(profile?.monthlyGoalCents).toBe(100_000)
    expect(profile?.currency).toBe('CHF')
    expect(profile?.completedAt).not.toBeNull()
  })

  it('propose ensuite de choisir une idée', async () => {
    const overview = await getCreatorOverview(userId, 'fr')
    expect(overview.journey.next?.id).toBe('idee')
    expect(overview.objective?.monthlyGoalLabel).toContain('1')
    expect(overview.journey.progress).toBeGreaterThan(0)
  })

  it('affiche l’objectif dans la monnaie choisie', async () => {
    const overview = await getCreatorOverview(userId, 'fr')
    expect(overview.objective?.monthlyGoalLabel).toContain('CHF')
  })

  /**
   * Une idée chiffrée en euros ne doit pas être réétiquetée en francs le jour où le
   * créateur change de monnaie : les montants ont été pensés pour un autre marché.
   */
  it('refuse de comparer une idée chiffrée dans une autre monnaie', async () => {
    await withUserScope(userId, (tx) =>
      tx.idea.create({
        data: {
          userId,
          title: 'Idée chiffrée en euros',
          problem: 'Un problème quelconque',
          audience: 'Des artisans',
          valueProposition: 'Une proposition',
          features: ['a'],
          businessModel: 'subscription',
          recommendedPriceCents: 1_200,
          currency: 'EUR',
          priceInterval: 'month',
          opportunityScore: 60,
          demandLevel: 'moyen',
          competitionLevel: 'moyen',
          complexityLevel: 'faible',
          operatingCostLevel: 'faible',
          timeToMarketWeeks: 4,
          customersNeeded: 167,
          risks: [],
          differentiators: [],
        },
      }),
    )

    const ideas = await listIdeas(userId)
    const imported = ideas.find((candidate) => candidate.title === 'Idée chiffrée en euros')
    expect(imported?.currency).toBe('EUR')
    expect(imported?.comparableToObjective).toBe(false)
    expect(imported?.objectiveSentence).toContain('autre monnaie')

    // Les tests suivants vérifient l'avancement du parcours : on rend l'état d'origine.
    await withUserScope(userId, (tx) => tx.idea.deleteMany({ where: { userId } }))
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
      create: { userId, planId: TEST_PLAN_ID, status: 'ACTIVE' },
      update: { planId: TEST_PLAN_ID, status: 'ACTIVE' },
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
    // L'offre de test ouvre tout : on lui pose une borne, puisque c'est la borne qu'on veut
    // éprouver. Un projet a déjà été créé plus haut.
    await prisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { maxProjects: 1 } })
    const idea = 'Une seconde application de test'
    await expect(
      createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
  })
})

describe('le cahier des charges commande la construction', () => {
  it('traduit un cahier des charges approuvé en plan pour le moteur existant', async () => {
    const { blueprintFromSpecSheet } = await import('@/server/projects/blueprints')

    const blueprint = blueprintFromSpecSheet({
      appName: 'Chaise Vide',
      tagline: 'Moins de rendez-vous manqués dans votre salon.',
      summary: 'Suivi des clients qui ne viennent pas, et relance simple.',
      problem: 'Les créneaux perdus coûtent cher aux salons de coiffure.',
      forWho: 'Les gérantes de salon indépendantes',
      mvpFeatures: [
        { title: 'Fiche client', why: 'Voir qui honore ses rendez-vous.' },
        { title: 'Enregistrer un rendez-vous', why: 'En trois touches maximum.' },
        { title: 'Clients à risque', why: 'Repérer les absences répétées.' },
      ],
      postponed: [{ title: 'Agenda complet', why: 'Trop lourd pour une première version.' }],
      paymentModel: 'subscription',
      whatIsPaid: "L'accès complet au suivi des clients.",
      externalServices: [
        { name: 'Encaissement des abonnements', why: 'Prélever chaque mois.', paid: true },
      ],
    })

    expect(blueprint.appName).toBe('Chaise Vide')
    expect(blueprint.features).toHaveLength(3)
    expect(blueprint.monetization[0]?.model).toBe('subscription')
    // Ce qui a été écarté et ce qui coûte de l'argent suit jusqu'au moteur : le créateur
    // le reverra dans son projet, il ne disparaît pas du parcours.
    expect(blueprint.limitations.some((line) => line.includes('Agenda complet'))).toBe(true)
    expect(blueprint.limitations.some((line) => line.includes('payant'))).toBe(true)
  })

  it('refuse de construire tant que le cahier des charges n’a pas été rédigé', async () => {
    const { createProjectFromIdea } = await import('@/server/projects/service')
    await expect(createProjectFromIdea(userId, randomUUID(), 'fr')).rejects.toThrow(AppError)
  })
})
