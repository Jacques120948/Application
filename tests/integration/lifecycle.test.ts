import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { getWallet } from '@/server/billing/credits'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import {
  applyManualPatch,
  createProject,
  getProject,
  listVersions,
  publishProject,
  restoreVersion,
  runProjectChecks,
} from '@/server/projects/service'
import { getPublishedApp } from '@/server/runtime/published'
import { createRecord, listRecords, updateRecord } from '@/server/runtime/records'
import { withRuntimeScope } from '@/server/db/scope'
import { AppError } from '@/lib/errors'
import type { DataField } from '@/server/spec/schema'

/** Parcours complet du MVP : créer, modifier, versionner, tester, publier, utiliser. */

/** Valeur valide pour chaque type de champ, quel que soit le modèle de données. */
function sampleInput(model: { fields: readonly DataField[] }): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const field of model.fields) {
    switch (field.type) {
      case 'number':
        input[field.id] = 3
        break
      case 'boolean':
        input[field.id] = true
        break
      case 'date':
        input[field.id] = '2026-03-03'
        break
      case 'select':
        input[field.id] = field.options?.[0]
        break
      case 'email':
        input[field.id] = 'client@exemple.test'
        break
      case 'url':
        input[field.id] = 'https://exemple.test'
        break
      case 'text':
      case 'longText':
        input[field.id] = 'Valeur de test'
        break
    }
  }
  return input
}

let userId: string
let projectId: string

/**
 * Abonne l'utilisateur à une offre qui autorise la construction.
 * L'offre de découverte s'arrête volontairement avant : sans cet abonnement, créer un
 * projet est refusé, ce qui est le comportement voulu du produit.
 */
async function subscribeToBuildPlan(userId: string, planId = 'builder'): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId, status: 'ACTIVE' },
    update: { planId, status: 'ACTIVE' },
  })
}

beforeAll(async () => {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: { maxProjects: plan.maxProjects, monthlyCredits: plan.monthlyCredits },
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  clearAll()
  const account = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  userId = account.userId
  await subscribeToBuildPlan(userId)
  const idea = 'Une application de réservation de créneaux pour un salon de coiffure'
  const created = await createProject(userId, {
    idea,
    locale: 'fr',
    blueprint: heuristicBlueprint(idea),
  })
  projectId = created.projectId
}, 60_000)

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('cycle de vie d’un projet', () => {
  it('crée une première version immuable', async () => {
    const versions = await listVersions(userId, projectId)
    expect(versions).toHaveLength(1)
    expect(versions[0]?.number).toBe(1)
    expect(versions[0]?.isCurrent).toBe(true)
  })

  it('applique une modification sans IA et crée une version', async () => {
    const before = await getProject(userId, projectId)
    const { spec, versionNumber } = await applyManualPatch(userId, projectId, {
      summary: 'Couleur principale en bleu',
      operations: [{ op: 'set', path: 'theme.colors.primary', value: '#1D4ED8' }],
    })
    expect(spec.theme.colors.primary).toBe('#1D4ED8')
    expect(versionNumber).toBe(2)
    expect(before.spec.theme.colors.primary).not.toBe('#1D4ED8')
  })

  it('restaure une version antérieure sans réécrire l’historique', async () => {
    const versions = await listVersions(userId, projectId)
    const first = versions.find((version) => version.number === 1)
    expect(first).toBeDefined()

    const restored = await restoreVersion(userId, projectId, first!.id)
    expect(restored.versionNumber).toBe(3)

    const after = await listVersions(userId, projectId)
    expect(after).toHaveLength(3)
    expect(after.find((version) => version.number === 2)).toBeDefined()
  })

  it('produit un rapport de test chiffré', async () => {
    const report = await runProjectChecks(userId, projectId)
    expect(report.score).toBeGreaterThan(0)
    expect(report.results.length).toBeGreaterThan(5)
    expect(report.counts.ok + report.counts.warn + report.counts.error).toBe(report.results.length)
  })

  it('publie et sert la version publiée', async () => {
    const published = await publishProject(userId, projectId)
    const { slug } = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { slug: true },
    })
    expect(published.url).toContain(slug)
    const app = await getPublishedApp(slug)
    expect(app.projectId).toBe(projectId)
    expect(app.spec.pages.length).toBeGreaterThan(0)
  })

  it('ne publie pas une application comportant une erreur bloquante', async () => {
    await applyManualPatch(userId, projectId, {
      summary: 'Contraste cassé',
      operations: [
        { op: 'set', path: 'theme.colors.text', value: '#FAFAFA' },
        { op: 'set', path: 'theme.colors.background', value: '#FFFFFF' },
      ],
    })
    await expect(publishProject(userId, projectId)).rejects.toThrow(AppError)

    // Réparation, puis la publication repasse.
    await applyManualPatch(userId, projectId, {
      summary: 'Contraste rétabli',
      operations: [{ op: 'set', path: 'theme.colors.text', value: '#0F172A' }],
    })
    await expect(publishProject(userId, projectId)).resolves.toBeTruthy()
  })
})

/** Un visiteur identifié de l'application de test. */
async function creerVisiteur() {
  return withRuntimeScope(projectId, (tx) =>
    tx.appEndUser.create({
      data: { projectId, email: `${randomUUID()}@exemple.test`, passwordHash: 'scrypt$x' },
    }),
  )
}

describe('données d’une application publiée', () => {
  it('valide les saisies contre le modèle déclaré', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels[0]!

    await expect(
      createRecord({
        projectId,
        spec: project.spec,
        modelId: model.id,
        endUserId: null,
        input: {},
      }),
    ).rejects.toThrow(AppError)
  })

  it('écarte les champs inconnus envoyés par le navigateur', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.scope === 'shared')
    if (model === undefined) return

    const input = { ...sampleInput(model), champInconnu: 'valeur pirate' }

    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
      input,
    })
    expect(Object.keys(record.data)).not.toContain('champInconnu')
  })

  it('cloisonne les données privées par utilisateur final', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.scope === 'user')
    if (model === undefined) return

    const endUser = await withRuntimeScope(projectId, (tx) =>
      tx.appEndUser.create({
        data: { projectId, email: `${randomUUID()}@exemple.test`, passwordHash: 'scrypt$x' },
      }),
    )

    const input = sampleInput(model)
    await createRecord({ projectId, spec: project.spec, modelId: model.id, endUserId: endUser.id, input })

    const mine = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: endUser.id,
    })
    expect(mine.length).toBe(1)

    // Un visiteur non connecté ne voit rien d'un modèle privé.
    const anonymous = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
    })
    expect(anonymous).toEqual([])
  })

  /*
   * Corriger une fiche. La règle est la même que pour la supprimer : celui qui a saisi une
   * donnée en dispose, personne d'autre. Ce sont ces refus qu'on vérifie ici, plus que le
   * cas qui marche.
   */
  it('laisse corriger sa propre fiche, et revalide la saisie', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.scope === 'user')
    if (model === undefined) return
    const champTexte = model.fields.find((field) => field.type === 'text')
    if (champTexte === undefined) return

    const endUser = await creerVisiteur()
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: endUser.id,
      input: sampleInput(model),
    })

    const corrige = await updateRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      recordId: record.id,
      endUserId: endUser.id,
      input: { ...sampleInput(model), [champTexte.id]: 'Valeur corrigée' },
    })
    expect(corrige.data[champTexte.id]).toBe('Valeur corrigée')

    // La correction repasse par la même validation que la création.
    await expect(
      updateRecord({
        projectId,
        spec: project.spec,
        modelId: model.id,
        recordId: record.id,
        endUserId: endUser.id,
        input: {},
      }),
    ).rejects.toThrow(AppError)

    // Et un champ inconnu glissé dans la requête n'atteint jamais la base.
    const propre = await updateRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      recordId: record.id,
      endUserId: endUser.id,
      input: { ...sampleInput(model), champInconnu: 'valeur pirate' },
    })
    expect(Object.keys(propre.data)).not.toContain('champInconnu')
  })

  it('refuse de laisser corriger la fiche d’un autre visiteur', async () => {
    const project = await getProject(userId, projectId)
    const prive = project.spec.dataModels.find((candidate) => candidate.scope === 'user')
    const partage = project.spec.dataModels.find((candidate) => candidate.scope === 'shared')

    if (prive !== undefined) {
      const auteur = await creerVisiteur()
      const autre = await creerVisiteur()
      const record = await createRecord({
        projectId,
        spec: project.spec,
        modelId: prive.id,
        endUserId: auteur.id,
        input: sampleInput(prive),
      })
      // Sur un modèle privé, l'élément d'autrui est déclaré introuvable : répondre
      // « interdit » révélerait son existence.
      await expect(
        updateRecord({
          projectId,
          spec: project.spec,
          modelId: prive.id,
          recordId: record.id,
          endUserId: autre.id,
          input: sampleInput(prive),
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }

    if (partage !== undefined) {
      const auteur = await creerVisiteur()
      const autre = await creerVisiteur()
      const record = await createRecord({
        projectId,
        spec: project.spec,
        modelId: partage.id,
        endUserId: auteur.id,
        input: sampleInput(partage),
      })
      // Sur un modèle partagé, tout le monde voit déjà l'élément : on peut dire la raison.
      await expect(
        updateRecord({
          projectId,
          spec: project.spec,
          modelId: partage.id,
          recordId: record.id,
          endUserId: autre.id,
          input: sampleInput(partage),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    }
  })
})

describe('crédits', () => {
  it('n’est pas débité par les opérations sans IA', async () => {
    const wallet = await getWallet(userId)
    const plan = DEFAULT_PLANS.find((candidate) => candidate.id === 'builder')!
    // Tout le parcours ci-dessus s'est fait sans appel au copilote : rien n'est débité.
    expect(wallet.balance).toBe(plan.monthlyCredits)
  })

  it('donne accès aux crédits de la nouvelle offre dès le changement', async () => {
    await subscribeToBuildPlan(userId, 'launch')
    const downgraded = await getWallet(userId)
    expect(downgraded.monthlyGrant).toBe(100)

    await subscribeToBuildPlan(userId, 'business')
    const upgraded = await getWallet(userId)
    expect(upgraded.monthlyGrant).toBe(800)
    expect(upgraded.balance).toBe(800)
  })
})
