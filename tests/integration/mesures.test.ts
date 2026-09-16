import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { applyManualPatch, createProject, getProject } from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { createRecord } from '@/server/runtime/records'
import { computePageMetrics } from '@/server/runtime/metrics'
import { withRuntimeScope } from '@/server/db/scope'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import type { AppSpec, DataField } from '@/server/spec/schema'

/**
 * Les chiffres d'un tableau de bord.
 *
 * Deux propriétés valent plus que les autres : la base compte, et non la page — un total
 * juste sur vingt fiches et faux sur deux mille ne servirait à rien — et une mesure sur des
 * données privées ne compte que celles de son lecteur. La seconde est une règle de
 * sécurité : un tableau de bord qui compterait les fiches de tout le monde serait une
 * fuite, discrète mais réelle.
 */

let userId: string
let projectId: string
let email: string

function sampleInput(model: { fields: readonly DataField[] }): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const field of model.fields) {
    if (field.type === 'computed') continue
    input[field.id] =
      field.type === 'number'
        ? 3
        : field.type === 'boolean'
          ? true
          : field.type === 'date'
            ? '2026-03-03'
            : field.type === 'select'
              ? field.options?.[0]
              : field.type === 'email'
                ? 'client@exemple.test'
                : field.type === 'url'
                  ? 'https://exemple.test'
                  : field.type === 'reference'
                    ? undefined
                    : 'Valeur'
  }
  return input
}

/** Ajoute au projet des données chiffrées et un tableau de bord qui les mesure. */
async function prepare(): Promise<AppSpec> {
  const project = await getProject(userId, projectId)
  const page = project.spec.pages[0]!
  await applyManualPatch(userId, projectId, {
    summary: 'Tableau de bord',
    operations: [
      { op: 'set', path: 'dataModels[0].scope', value: 'shared' },
      {
        op: 'append',
        path: 'dataModels[0].fields',
        value: { id: 'montant', label: 'Montant', type: 'number', required: false },
      },
      {
        op: 'append',
        path: 'dataModels[0].fields',
        value: {
          id: 'statut',
          label: 'Statut',
          type: 'select',
          required: false,
          options: ['en-cours', 'paye'],
        },
      },
      {
        op: 'append',
        path: 'pages[0].blocks',
        value: {
          id: 'tableau-de-bord',
          type: 'metrics',
          title: 'Vos chiffres',
          items: [
            { id: 'combien', label: 'Fiches', modelId: project.spec.dataModels[0]!.id, kind: 'nombre', period: 'tout' },
            {
              id: 'total',
              label: 'Total',
              modelId: project.spec.dataModels[0]!.id,
              kind: 'somme',
              field: 'montant',
              period: 'tout',
              unit: '€',
            },
            {
              id: 'payes',
              label: 'Encaissé',
              modelId: project.spec.dataModels[0]!.id,
              kind: 'somme',
              field: 'montant',
              period: 'tout',
              filterField: 'statut',
              filterValue: 'paye',
            },
            {
              id: 'recent',
              label: 'Ce mois',
              modelId: project.spec.dataModels[0]!.id,
              kind: 'nombre',
              period: '30j',
            },
          ],
        },
      },
    ],
  })
  void page
  return (await getProject(userId, projectId)).spec
}

beforeAll(async () => {
  clearAll()
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  email = `mesures-${Date.now()}@exemple.test`
  const created = await register(
    { email, password: 'motdepasse-2026-solide', locale: 'fr' },
    { ip: randomUUID() },
  )
  userId = created.userId
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId: 'builder', status: 'ACTIVE' },
    update: { planId: 'builder', status: 'ACTIVE' },
  })
  const idea = 'Un suivi des devis pour un artisan'
  const project = await createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) })
  projectId = project.projectId

  const spec = await prepare()
  const model = spec.dataModels[0]!
  for (const [montant, statut] of [
    [100, 'paye'],
    [250, 'paye'],
    [50, 'en-cours'],
  ] as const) {
    await createRecord({
      projectId,
      spec,
      modelId: model.id,
      endUserId: null,
      input: { ...sampleInput(model), montant, statut },
    })
  }
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})

describe('ce que la base compte', () => {
  it('compte les fiches, totalise, et sait restreindre à un statut', async () => {
    const { spec } = await getProject(userId, projectId)
    const mesures = await computePageMetrics({
      projectId,
      spec,
      page: spec.pages[0]!,
      endUserId: null,
    })
    const valeurs = Object.fromEntries(
      (mesures['tableau-de-bord'] ?? []).map((mesure) => [mesure.id, mesure.value]),
    )
    expect(valeurs.combien).toBe(3)
    expect(valeurs.total).toBe(400)
    expect(valeurs.payes).toBe(350)
    expect(valeurs.recent).toBe(3)
  })

  it('ne compte que la période demandée', async () => {
    // On vieillit une fiche : elle sort de la fenêtre des 30 jours, pas du total.
    const ancienne = await withRuntimeScope(projectId, (tx) =>
      tx.appRecord.findFirstOrThrow({ where: { projectId }, select: { id: true } }),
    )
    await withRuntimeScope(projectId, (tx) =>
      tx.appRecord.update({
        where: { id: ancienne.id },
        data: { createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      }),
    )

    const { spec } = await getProject(userId, projectId)
    const mesures = await computePageMetrics({ projectId, spec, page: spec.pages[0]!, endUserId: null })
    const valeurs = Object.fromEntries(
      (mesures['tableau-de-bord'] ?? []).map((mesure) => [mesure.id, mesure.value]),
    )
    expect(valeurs.combien).toBe(3)
    expect(valeurs.recent).toBe(2)
  })

  it('porte son libellé de période, pour que le chiffre se lise sans deviner', async () => {
    const { spec } = await getProject(userId, projectId)
    const mesures = await computePageMetrics({ projectId, spec, page: spec.pages[0]!, endUserId: null })
    const recent = (mesures['tableau-de-bord'] ?? []).find((mesure) => mesure.id === 'recent')
    expect(recent?.period).toBe('sur les 30 derniers jours')
  })
})

describe('ce qu’une mesure ne doit pas laisser voir', () => {
  it('ne compte rien sur des données privées sans visiteur connecté', async () => {
    await applyManualPatch(userId, projectId, {
      summary: 'Données redevenues privées',
      operations: [{ op: 'set', path: 'dataModels[0].scope', value: 'user' }],
    })

    const { spec } = await getProject(userId, projectId)
    const mesures = await computePageMetrics({ projectId, spec, page: spec.pages[0]!, endUserId: null })
    for (const mesure of mesures['tableau-de-bord'] ?? []) {
      expect(mesure.value).toBeNull()
    }
  })

  it('ne compte que les fiches du visiteur qui regarde', async () => {
    const visiteur = await withRuntimeScope(projectId, (tx) =>
      tx.appEndUser.create({
        data: { projectId, email: `${randomUUID()}@exemple.test`, passwordHash: 'scrypt$x' },
      }),
    )
    const { spec } = await getProject(userId, projectId)
    const model = spec.dataModels[0]!
    await createRecord({
      projectId,
      spec,
      modelId: model.id,
      endUserId: visiteur.id,
      input: { ...sampleInput(model), montant: 999, statut: 'paye' },
    })

    const mesures = await computePageMetrics({
      projectId,
      spec,
      page: spec.pages[0]!,
      endUserId: visiteur.id,
    })
    const valeurs = Object.fromEntries(
      (mesures['tableau-de-bord'] ?? []).map((mesure) => [mesure.id, mesure.value]),
    )
    // Les trois fiches saisies plus tôt ne lui appartiennent pas : il ne voit que la sienne.
    expect(valeurs.combien).toBe(1)
    expect(valeurs.total).toBe(999)
  })
})

describe('une mesure impossible ne vaut pas zéro', () => {
  it('rend « rien » quand le champ mesuré n’existe plus', async () => {
    const { spec } = await getProject(userId, projectId)
    const abime: AppSpec = {
      ...spec,
      pages: spec.pages.map((page, index) =>
        index !== 0
          ? page
          : {
              ...page,
              blocks: page.blocks.map((block) =>
                block.type !== 'metrics'
                  ? block
                  : {
                      ...block,
                      items: block.items.map((item) => ({ ...item, field: 'champ-disparu' })),
                    },
              ),
            },
      ),
    }
    const mesures = await computePageMetrics({
      projectId,
      spec: abime,
      page: abime.pages[0]!,
      endUserId: null,
    })
    const sommes = (mesures['tableau-de-bord'] ?? []).filter((mesure) => mesure.id === 'total')
    expect(sommes[0]?.value).toBeNull()
  })
})
