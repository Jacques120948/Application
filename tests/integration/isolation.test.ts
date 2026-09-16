import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { createProject, getProject, publishProject } from '@/server/projects/service'
import {
  createRecord,
  deleteOwnerRecord,
  exportOwnerRecords,
  listOwnerRecords,
  listRecords,
  updateOwnerRecord,
} from '@/server/runtime/records'
import { withRuntimeScope, withUserScope } from '@/server/db/scope'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { AppError } from '@/lib/errors'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { publicAppUrl } from '@/lib/apps-domain'
import { ensureTestPlan, TEST_PLAN_ID } from '../helpers/plan'

/**
 * Isolation multi-tenant (exigence 18).
 *
 * Ces tests tournent sur une vraie base avec le rôle applicatif soumis au Row Level
 * Security. Ils vérifient à la fois la couche applicative et le filet PostgreSQL.
 */

type Fixture = { userId: string; projectId: string }

async function makeUser(): Promise<string> {
  clearAll()
  const { userId } = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  return userId
}

/**
 * Abonne l'utilisateur à une offre qui autorise la construction.
 * L'offre de découverte s'arrête volontairement avant : sans cet abonnement, créer un
 * projet est refusé, ce qui est le comportement voulu du produit.
 */
async function subscribeToBuildPlan(userId: string, planId = TEST_PLAN_ID): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId, status: 'ACTIVE' },
    update: { planId, status: 'ACTIVE' },
  })
}

async function makeProject(userId: string, idea: string): Promise<string> {
  await subscribeToBuildPlan(userId)
  const blueprint = heuristicBlueprint(idea)
  const created = await createProject(userId, { idea, locale: 'fr', blueprint })
  return created.projectId
}

let alice: Fixture
let bob: Fixture

beforeAll(async () => {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: { maxProjects: plan.maxProjects },
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  // L'offre technique des tests : elle ouvre tout, et ne dépend d'aucune décision commerciale.
  await ensureTestPlan()
  const aliceId = await makeUser()
  const bobId = await makeUser()
  alice = { userId: aliceId, projectId: await makeProject(aliceId, 'Un carnet de recettes de cuisine partagé') }
  bob = { userId: bobId, projectId: await makeProject(bobId, 'Un annuaire des artisans de ma ville') }
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [alice.userId, bob.userId] } } })
  await prisma.$disconnect()
})

describe('isolation entre créateurs', () => {
  it('un créateur ne peut pas ouvrir le projet d’un autre', async () => {
    await expect(getProject(bob.userId, alice.projectId)).rejects.toThrow(AppError)
    await expect(getProject(bob.userId, alice.projectId)).rejects.toMatchObject({
      // « introuvable » et non « interdit » : ne pas confirmer l'existence du projet d'autrui.
      code: 'NOT_FOUND',
    })
  })

  it('PostgreSQL filtre les lignes même si le code oublie la condition de propriété', async () => {
    const visible = await withUserScope(bob.userId, (tx) =>
      tx.project.findMany({ select: { id: true } }),
    )
    const ids = visible.map((project) => project.id)
    expect(ids).toContain(bob.projectId)
    expect(ids).not.toContain(alice.projectId)
  })

  it('les versions d’un projet ne sont pas lisibles depuis une autre portée', async () => {
    const versions = await withUserScope(bob.userId, (tx) =>
      tx.projectVersion.findMany({ where: { projectId: alice.projectId } }),
    )
    expect(versions).toEqual([])
  })

  it('une écriture au nom d’un autre créateur est refusée par la base', async () => {
    await expect(
      withUserScope(bob.userId, (tx) =>
        tx.project.create({
          data: {
            ownerId: alice.userId,
            name: 'Projet injecté',
            slug: `injecte-${randomUUID()}`,
            draftSpec: {},
          },
        }),
      ),
    ).rejects.toThrow()
  })
})

describe('isolation des données des applications générées', () => {
  it('les enregistrements d’une application ne fuient pas vers une autre', async () => {
    const aliceProject = await getProject(alice.userId, alice.projectId)
    const model = aliceProject.spec.dataModels[0]
    expect(model).toBeDefined()

    const values: Record<string, unknown> = {}
    for (const field of model!.fields) {
      values[field.id] = field.type === 'number' ? 1 : field.type === 'boolean' ? true : field.type === 'date' ? '2026-01-01' : field.type === 'select' ? field.options?.[0] : field.type === 'email' ? 'a@b.fr' : field.type === 'url' ? 'https://exemple.fr' : 'Valeur de test'
    }

    await createRecord({
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model!.id,
      endUserId: null,
      input: values,
    })

    const seenByAlice = await listRecords({
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model!.id,
      endUserId: null,
    })
    expect(seenByAlice.items.length).toBeGreaterThan(0)
    expect(seenByAlice.total).toBeGreaterThan(0)

    // Depuis la portée du projet de Bob, rien de ce qui appartient à Alice n'est visible.
    const fromBobScope = await withRuntimeScope(bob.projectId, (tx) =>
      tx.appRecord.findMany({ where: { projectId: alice.projectId } }),
    )
    expect(fromBobScope).toEqual([])
  })
})

/*
 * Le créateur agit sur les données de son application, et seulement sur les siennes.
 * C'est le point le plus sensible de cette fonction : elle donne à quelqu'un le droit de
 * corriger et de supprimer des fiches qu'il n'a pas saisies.
 */
describe('données vues et corrigées par le créateur', () => {
  it('ne laisse pas un créateur toucher aux données d’un autre', async () => {
    const aliceProject = await getProject(alice.userId, alice.projectId)
    const model = aliceProject.spec.dataModels.find((candidate) => candidate.scope === 'shared')
    if (model === undefined) return

    const champ = model.fields.find((field) => field.type === 'text')
    if (champ === undefined) return
    const values: Record<string, unknown> = {}
    for (const field of model.fields) {
      values[field.id] =
        field.type === 'number'
          ? 1
          : field.type === 'boolean'
            ? true
            : field.type === 'date'
              ? '2026-04-04'
              : field.type === 'select'
                ? field.options?.[0]
                : field.type === 'email'
                  ? 'client@exemple.test'
                  : field.type === 'url'
                    ? 'https://exemple.test'
                    : 'Valeur'
    }
    const record = await createRecord({
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model.id,
      endUserId: null,
      input: values,
    })

    // Alice voit et corrige ce que son application a collecté.
    const page = await listOwnerRecords({
      userId: alice.userId,
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model.id,
    })
    expect(page.total).toBeGreaterThan(0)

    const corrige = await updateOwnerRecord({
      userId: alice.userId,
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model.id,
      recordId: record.id,
      input: { ...values, [champ.id]: 'Confirmé par Alice' },
    })
    expect(corrige.data[champ.id]).toBe('Confirmé par Alice')

    // Bob ne voit rien du projet d'Alice, et ne peut ni corriger ni supprimer ses fiches.
    await expect(
      listOwnerRecords({
        userId: bob.userId,
        projectId: alice.projectId,
        spec: aliceProject.spec,
        modelId: model.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      updateOwnerRecord({
        userId: bob.userId,
        projectId: alice.projectId,
        spec: aliceProject.spec,
        modelId: model.id,
        recordId: record.id,
        input: values,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      deleteOwnerRecord({
        userId: bob.userId,
        projectId: alice.projectId,
        modelId: model.id,
        recordId: record.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // Et la fiche est toujours là, inchangée.
    const apres = await listOwnerRecords({
      userId: alice.userId,
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model.id,
    })
    expect(apres.items.some((item) => item.data[champ.id] === 'Confirmé par Alice')).toBe(true)

    // L'export sort une ligne d'en-tête et une ligne par fiche.
    const fichier = await exportOwnerRecords({
      userId: alice.userId,
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model.id,
    })
    expect(fichier.filename).toMatch(/\.csv$/)
    expect(fichier.content.split('\n').length).toBe(apres.total + 1)
    expect(fichier.content).toContain('Confirmé par Alice')

    // Alice peut écarter une fiche qu'elle n'a pas saisie ; c'est le sens de la fonction.
    await deleteOwnerRecord({
      userId: alice.userId,
      projectId: alice.projectId,
      modelId: model.id,
      recordId: record.id,
    })
    const final = await listOwnerRecords({
      userId: alice.userId,
      projectId: alice.projectId,
      spec: aliceProject.spec,
      modelId: model.id,
    })
    expect(final.items.some((item) => item.id === record.id)).toBe(false)
  })
})

describe('publication', () => {
  it('ne sert au public que la version figée', async () => {
    const published = await publishProject(alice.userId, alice.projectId)
    // L'adresse rendue est l'adresse publique de cette application, quelle que soit la
    // forme qu'elle prend sur cette installation : chemin partagé ou sous-domaine propre.
    const project0 = await prisma.project.findUniqueOrThrow({
      where: { id: alice.projectId },
      select: { slug: true },
    })
    expect(published.url).toBe(publicAppUrl(project0.slug))
    expect(published.url).toContain(project0.slug)

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: alice.projectId },
      select: { publishedVersionId: true, publishedAt: true },
    })
    expect(project.publishedVersionId).not.toBeNull()
    expect(project.publishedAt).not.toBeNull()
  })
})
