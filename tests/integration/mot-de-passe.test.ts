import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { confirmPasswordReset, requestPasswordReset } from '@/server/auth/password-reset'
import { confirmEndUserReset, requestEndUserReset } from '@/server/runtime/end-users'
import { createProject } from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { withRuntimeScope } from '@/server/db/scope'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { AppError } from '@/lib/errors'
import { ensureTestPlan, TEST_PLAN_ID } from '../helpers/plan'

/**
 * Le courrier est intercepté, pas envoyé : le jeton en clair n'existe que dans le message,
 * et c'est la seule façon d'éprouver le parcours de bout en bout — exactement ce que fait
 * la personne qui clique sur le lien.
 */
const { courriels } = vi.hoisted(() => ({
  courriels: [] as Array<{ to: string; subject: string; text: string }>,
}))

vi.mock('@/server/email/send', () => ({
  isEmailAvailable: () => true,
  sendEmail: async (message: { to: string; subject: string; text: string }) => {
    courriels.push(message)
  },
}))

/**
 * Réinitialisation du mot de passe, sur une vraie base.
 *
 * Le jeton n'est lisible que dans l'e-mail : ces tests vérifient donc ce qui se passe en
 * base, et surtout ce qui ne s'y passe pas quand l'adresse est inconnue.
 */

let email: string
let userId: string

beforeAll(async () => {
  clearAll()
  email = `reset-${Date.now()}@exemple.test`
  const created = await register({
    email,
    password: 'motdepasse-2026-solide',
    locale: 'fr',
  })
  userId = created.userId
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('demande de réinitialisation', () => {
  it('crée un jeton pour un compte existant', async () => {
    await requestPasswordReset(email, { ip: '203.0.113.10' })
    const tokens = await prisma.verificationToken.findMany({
      where: { userId, purpose: 'PASSWORD_RESET', consumedAt: null },
    })
    expect(tokens).toHaveLength(1)
    // Le jeton n'est jamais stocké en clair : seule une empreinte hexadécimale figure.
    expect(tokens[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ne laisse qu’un seul lien vivant : une nouvelle demande annule la précédente', async () => {
    await requestPasswordReset(email, { ip: '203.0.113.11' })
    const alive = await prisma.verificationToken.count({
      where: { userId, purpose: 'PASSWORD_RESET', consumedAt: null },
    })
    expect(alive).toBe(1)
  })

  it('ne crée rien pour une adresse inconnue, et ne le fait pas savoir', async () => {
    const before = await prisma.verificationToken.count()
    await expect(
      requestPasswordReset(`inconnu-${Date.now()}@exemple.test`, { ip: '203.0.113.12' }),
    ).resolves.toBeUndefined()
    expect(await prisma.verificationToken.count()).toBe(before)
  })
})

describe('changement de mot de passe', () => {
  it('refuse un jeton inventé', async () => {
    await expect(
      confirmPasswordReset('jeton-invente-mais-assez-long-pour-passer', 'motdepasse-2026', {
        ip: '203.0.113.13',
      }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('refuse un mot de passe trop faible avant même de regarder le jeton', async () => {
    await expect(
      confirmPasswordReset('jeton-invente-mais-assez-long-pour-passer', 'court', {
        ip: '203.0.113.14',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

/**
 * Même parcours, côté visiteur d'une application créée.
 *
 * Il ne partage aucune table avec celui du créateur : un jeton d'application ne peut pas
 * ouvrir un compte Evoliia, et un jeton d'une application ne vaut rien dans une autre.
 * Ces tests vérifient exactement cela, sur la vraie base soumise au Row Level Security.
 */
describe('mot de passe oublié dans une application créée', () => {
  let createurId: string
  let projectA: string
  let projectB: string
  let visiteur: string
  let adresse: string

  beforeAll(async () => {
    clearAll()
    const planId = TEST_PLAN_ID
    for (const plan of DEFAULT_PLANS) {
      await prisma.plan.upsert({
        where: { id: plan.id },
        update: {},
        create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
      })
    }
    // L'offre technique des tests : elle ouvre tout, et ne dépend d'aucune décision commerciale.
    await ensureTestPlan()
    const createur = await register(
      { email: `app-reset-${Date.now()}@exemple.test`, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: '203.0.113.20' },
    )
    createurId = createur.userId
    await prisma.subscription.upsert({
      where: { userId: createurId },
      create: { userId: createurId, planId, status: 'ACTIVE' },
      update: { planId, status: 'ACTIVE' },
    })
    const idees = ['Un carnet de recettes partagé', 'Un annuaire des artisans']
    const projets = []
    for (const idee of idees) {
      const cree = await createProject(createurId, {
        idea: idee,
        locale: 'fr',
        blueprint: heuristicBlueprint(idee),
      })
      projets.push(cree.projectId)
    }
    projectA = projets[0]!
    projectB = projets[1]!

    adresse = `visiteur-${Date.now()}@exemple.test`
    const cree = await withRuntimeScope(projectA, (tx) =>
      tx.appEndUser.create({ data: { projectId: projectA, email: adresse, passwordHash: 'scrypt$x' } }),
    )
    visiteur = cree.id
  }, 60_000)

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: createurId } })
  })

  it('crée un jeton haché pour un visiteur existant', async () => {
    await requestEndUserReset({
      projectId: projectA,
      appName: 'Application de test',
      appUrl: 'http://localhost:3000/a/test/accueil',
      email: adresse,
      ip: '203.0.113.21',
    })
    // Les tables d'une application sont cachées par le Row Level Security : les lire
    // demande le même passage par le projet que le code de production.
    const jetons = await withRuntimeScope(projectA, (tx) =>
      tx.appEndUserToken.findMany({ where: { endUserId: visiteur, consumedAt: null } }),
    )
    expect(jetons).toHaveLength(1)
    expect(jetons[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ne laisse qu’un seul lien vivant', async () => {
    await requestEndUserReset({
      projectId: projectA,
      appName: 'Application de test',
      appUrl: 'http://localhost:3000/a/test/accueil',
      email: adresse,
      ip: '203.0.113.22',
    })
    const vivants = await withRuntimeScope(projectA, (tx) =>
      tx.appEndUserToken.count({ where: { endUserId: visiteur, consumedAt: null } }),
    )
    expect(vivants).toBe(1)
  })

  it('ne crée rien quand l’adresse est inscrite dans une autre application', async () => {
    const avant = await withRuntimeScope(projectB, (tx) => tx.appEndUserToken.count())
    // La même adresse, mais sur le projet voisin : les comptes sont cloisonnés.
    await expect(
      requestEndUserReset({
        projectId: projectB,
        appName: 'Autre application',
        appUrl: 'http://localhost:3000/a/autre/accueil',
        email: adresse,
        ip: '203.0.113.23',
      }),
    ).resolves.toBeUndefined()
    expect(await withRuntimeScope(projectB, (tx) => tx.appEndUserToken.count())).toBe(avant)
  })

  it('refuse un jeton inventé', async () => {
    await expect(
      confirmEndUserReset({
        projectId: projectA,
        token: 'jeton-invente-mais-assez-long',
        password: 'motdepasse-2026-solide',
        ip: '203.0.113.24',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('refuse un mot de passe trop faible avant de regarder le jeton', async () => {
    await expect(
      confirmEndUserReset({
        projectId: projectA,
        token: 'jeton-invente-mais-assez-long',
        password: 'court',
        ip: '203.0.113.25',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('change le mot de passe, consomme le lien et ferme les sessions ouvertes', async () => {
    // Une session ouverte, celle que la réinitialisation doit chasser.
    await withRuntimeScope(projectA, (tx) =>
      tx.appEndUserSession.create({
        data: {
          projectId: projectA,
          endUserId: visiteur,
          tokenHash: `session-${Date.now()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    )

    courriels.length = 0
    await requestEndUserReset({
      projectId: projectA,
      appName: 'Application de test',
      appUrl: 'http://localhost:3000/a/test/accueil',
      email: adresse,
      ip: '203.0.113.26',
    })
    const message = courriels.at(-1)
    expect(message?.to).toBe(adresse)
    expect(message?.subject).toContain('Application de test')
    const jeton = new URL(message!.text.split('\n').find((ligne) => ligne.startsWith('http'))!)
      .searchParams.get('jeton')
    expect(jeton).not.toBeNull()

    await confirmEndUserReset({
      projectId: projectA,
      token: jeton!,
      password: 'nouveau-motdepasse-2026',
      ip: '203.0.113.27',
    })

    const etat = await withRuntimeScope(projectA, async (tx) => ({
      compte: await tx.appEndUser.findUniqueOrThrow({ where: { id: visiteur } }),
      liensVivants: await tx.appEndUserToken.count({
        where: { endUserId: visiteur, consumedAt: null },
      }),
      sessionsOuvertes: await tx.appEndUserSession.count({
        where: { endUserId: visiteur, revokedAt: null },
      }),
    }))
    expect(etat.compte.passwordHash).not.toBe('scrypt$x')
    expect(etat.liensVivants).toBe(0)
    expect(etat.sessionsOuvertes).toBe(0)

    // Le même lien ne sert pas deux fois.
    await expect(
      confirmEndUserReset({
        projectId: projectA,
        token: jeton!,
        password: 'encore-un-autre-2026',
        ip: '203.0.113.28',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})
