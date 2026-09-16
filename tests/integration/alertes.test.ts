import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { createProject, getProject } from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { alertOwnerOfNewRecord, alertQuota, DEFAULT_DAILY_CAP } from '@/server/runtime/alerts'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { withUserScope } from '@/server/db/scope'
import type { DataModel } from '@/server/spec/schema'
import { ensureTestPlan, TEST_PLAN_ID } from '../helpers/plan'

/**
 * Les alertes au créateur.
 *
 * C'est Evoliia qui paie le courriel : trois propriétés en découlent, et ce sont elles qu'on
 * éprouve ici. Le quota de l'offre borne les envois. Un plafond journalier par application
 * arrête celle qui s'emballe. Et la notification dans l'atelier, qui ne coûte rien, a
 * toujours lieu — même quand l'e-mail est retenu, le créateur est informé.
 *
 * Quatrième propriété, la plus importante pour le visiteur : rien de tout cela ne peut
 * faire échouer sa saisie.
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

let userId: string
let projectId: string
let email: string
let model: DataModel

async function alerter(): Promise<void> {
  await alertOwnerOfNewRecord({
    ownerId: userId,
    projectId,
    appName: 'Fiches Artisan',
    appUrl: 'http://localhost:3000/a/fiches',
    model,
    recordId: randomUUID(),
    data: { client: 'Boulangerie Martin' },
  })
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
  // L'offre technique des tests : elle ouvre tout, et ne dépend d'aucune décision commerciale.
  await ensureTestPlan()
  email = `alertes-${Date.now()}@exemple.test`
  const created = await register(
    { email, password: 'motdepasse-2026-solide', locale: 'fr' },
    { ip: randomUUID() },
  )
  userId = created.userId
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId: TEST_PLAN_ID, status: 'ACTIVE' },
    update: { planId: TEST_PLAN_ID, status: 'ACTIVE' },
  })
  const idea = 'Un annuaire des artisans de ma ville'
  const project = await createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) })
  projectId = project.projectId
  model = (await getProject(userId, projectId)).spec.dataModels[0]!
}, 60_000)

beforeEach(async () => {
  courriels.length = 0
  await prisma.ownerAlert.deleteMany({ where: { userId } })
  await withUserScope(userId, (tx) => tx.notification.deleteMany({ where: { userId } }))
  await prisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { alertsPerMonth: 3 } })
})

afterAll(async () => {
  await prisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { alertsPerMonth: 0 } })
  await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})

describe('quand l’offre le permet', () => {
  it('envoie le courriel et compte l’alerte', async () => {
    await alerter()
    expect(courriels).toHaveLength(1)
    expect(courriels[0]?.to).toBe(email)
    expect(courriels[0]?.subject).toContain('Fiches Artisan')
    expect((await alertQuota(userId)).used).toBe(1)
  })

  it('prévient aussi dans l’atelier', async () => {
    await alerter()
    // La table des notifications est masquée par le Row Level Security : la lire demande
    // le même passage par l'utilisateur que le code de production.
    const cloche = await withUserScope(userId, (tx) =>
      tx.notification.findFirst({ where: { userId, kind: 'app_record' } }),
    )
    expect(cloche).not.toBeNull()
    expect(cloche?.title).toContain('Fiches Artisan')
  })
})

describe('ce qui arrête les envois', () => {
  it('s’arrête au quota du mois, et le dit dans la trace', async () => {
    for (let index = 0; index < 5; index += 1) await alerter()
    expect(courriels).toHaveLength(3)

    const retenues = await prisma.ownerAlert.findMany({ where: { userId, sent: false } })
    expect(retenues).toHaveLength(2)
    expect(retenues[0]?.reason).toContain('quota')
  })

  it('prévient quand même dans l’atelier une fois le quota atteint', async () => {
    for (let index = 0; index < 5; index += 1) await alerter()
    // Cinq saisies, cinq notifications : ce qui est plafonné, c'est l'envoi, pas l'information.
    const cloches = await withUserScope(userId, (tx) =>
      tx.notification.count({ where: { userId, kind: 'app_record' } }),
    )
    expect(cloches).toBe(5)
  })

  it('n’envoie rien quand l’offre n’ouvre pas la fonction', async () => {
    await prisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { alertsPerMonth: 0 } })
    await alerter()
    expect(courriels).toHaveLength(0)
    const retenue = await prisma.ownerAlert.findFirst({ where: { userId, sent: false } })
    expect(retenue?.reason).toContain('offre')
  })

  it('arrête une application qui s’emballe, même si le quota du mois reste ouvert', async () => {
    await prisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { alertsPerMonth: 100_000 } })
    // On simule une journée déjà chargée : le plafond journalier porte sur l'application.
    await prisma.ownerAlert.createMany({
      data: Array.from({ length: DEFAULT_DAILY_CAP }, () => ({
        userId,
        projectId,
        modelId: model.id,
        recordId: randomUUID(),
        sent: true,
      })),
    })
    await alerter()
    expect(courriels).toHaveLength(0)
    const retenue = await prisma.ownerAlert.findFirst({
      where: { userId, sent: false },
      orderBy: { createdAt: 'desc' },
    })
    expect(retenue?.reason).toContain('journalier')
  })
})

describe('ce qui ne doit jamais arriver', () => {
  it('ne lève pas, même si tout va mal', async () => {
    await expect(
      alertOwnerOfNewRecord({
        ownerId: randomUUID(),
        projectId,
        appName: 'Fiches',
        appUrl: 'http://localhost:3000/a/fiches',
        model,
        recordId: randomUUID(),
        data: {},
      }),
    ).resolves.toBeUndefined()
  })
})
