import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import {
  applyManualPatch,
  createProject,
  decidePlan,
  editWithAgent,
  getProject,
  listChatMessages,
} from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import type { PatchOperation } from '@/server/spec/patch'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Le mode plan, de bout en bout.
 *
 * Ce qui se vérifie ici tient en une phrase : **rien n'est écrit tant que le créateur n'a
 * pas décidé**, et ce qui est écrit ensuite est exactement ce qui avait été annoncé. Plus
 * une garantie qui n'est pas une coquetterie : un plan calculé sur un brouillon qui a
 * changé depuis est refusé, pas appliqué à l'aveugle.
 *
 * L'agent lui-même est remplacé par un double : ce n'est pas lui qu'on éprouve ici, mais
 * ce que le service fait de ce qu'il rend.
 */

const { reponse } = vi.hoisted(() => ({
  reponse: { operations: [] as unknown[], summary: 'Modification', reply: 'Voilà.' },
}))

vi.mock('@/server/agent/loop', () => ({
  runAgent: async (params: { spec: unknown }) => {
    const { applyPatch, specPatchSchema } = await import('@/server/spec/patch')
    const spec = params.spec as Parameters<typeof applyPatch>[0]
    const operations = reponse.operations as PatchOperation[]
    return {
      reply: reponse.reply,
      spec:
        operations.length === 0
          ? spec
          : applyPatch(spec, specPatchSchema.parse({ summary: reponse.summary, operations })),
      operations,
      summary: reponse.summary,
      creditsSpent: 3,
      balance: 100,
      read: [],
      steps: 2,
      stoppedBy: null,
    }
  },
}))

let userId: string
let projectId: string
let email: string

/** Touche aux données : doit toujours être soumise au créateur. */
function champObligatoire(): PatchOperation[] {
  return [{ op: 'set', path: 'dataModels[0].fields[0].required', value: true }]
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
  email = `plan-${Date.now()}@exemple.test`
  const created = await register(
    { email, password: 'motdepasse-2026-solide', locale: 'fr' },
    { ip: randomUUID() },
  )
  userId = created.userId
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId: testPlanId(), status: 'ACTIVE' },
    update: { planId: testPlanId(), status: 'ACTIVE' },
  })
  const idea = 'Un annuaire des artisans de ma ville'
  const project = await createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) })
  projectId = project.projectId
}, 60_000)

beforeEach(async () => {
  clearAll()
  reponse.operations = champObligatoire()
  reponse.summary = 'Champ obligatoire'
  reponse.reply = 'J’ai rendu le champ obligatoire. Les fiches sans cette valeur ne pourront plus être enregistrées.'
  // Aucune proposition d'un essai précédent ne doit traîner.
  await prisma.chatMessage.updateMany({
    where: { projectId, planStatus: 'PROPOSED' },
    data: { planStatus: 'STALE' },
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})

describe('annoncer avant d’appliquer', () => {
  it('n’écrit rien et rend une proposition', async () => {
    const avant = await getProject(userId, projectId)
    const outcome = await editWithAgent(userId, projectId, 'rends le premier champ obligatoire')

    expect(outcome.applied).toBe(false)
    expect(outcome.plan).toBeDefined()
    expect(outcome.plan?.reasons.join(' ')).toContain('fiches déjà saisies')

    const apres = await getProject(userId, projectId)
    expect(JSON.stringify(apres.spec)).toBe(JSON.stringify(avant.spec))
  })

  it('retrouve la proposition après un rechargement de page', async () => {
    const outcome = await editWithAgent(userId, projectId, 'rends le premier champ obligatoire')
    const messages = await listChatMessages(userId, projectId)
    const attente = messages.find((message) => 'plan' in message && message.plan !== undefined)
    expect(attente).toBeDefined()
    expect((attente as { plan: { id: string } }).plan.id).toBe(outcome.plan!.id)
  })

  it('applique exactement ce qui avait été annoncé', async () => {
    const outcome = await editWithAgent(userId, projectId, 'rends le premier champ obligatoire')
    const decision = await decidePlan(userId, projectId, outcome.plan!.id, 'apply')

    expect(decision.applied).toBe(true)
    expect(decision.versionNumber).not.toBeNull()
    expect((await getProject(userId, projectId)).spec.dataModels[0]!.fields[0]!.required).toBe(true)
  })

  it('n’applique rien quand on annule', async () => {
    const avant = await getProject(userId, projectId)
    // Une suppression qui laisse l'application valide : une page garde au moins une section.
    const index = avant.spec.pages.findIndex((page) => page.blocks.length >= 2)
    expect(index).toBeGreaterThanOrEqual(0)
    reponse.operations = [{ op: 'delete', path: `pages[${index}].blocks[1]` }]
    const outcome = await editWithAgent(userId, projectId, 'supprime la première section')

    const decision = await decidePlan(userId, projectId, outcome.plan!.id, 'cancel')
    expect(decision.applied).toBe(false)
    expect(JSON.stringify((await getProject(userId, projectId)).spec)).toBe(JSON.stringify(avant.spec))
  })

  it('refuse de décider deux fois', async () => {
    const outcome = await editWithAgent(userId, projectId, 'rends le premier champ obligatoire')
    await decidePlan(userId, projectId, outcome.plan!.id, 'cancel')
    await expect(decidePlan(userId, projectId, outcome.plan!.id, 'apply')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('refuse un plan calculé sur un brouillon qui a changé depuis', async () => {
    const outcome = await editWithAgent(userId, projectId, 'rends le premier champ obligatoire')

    // Entre-temps, le créateur retouche son application à la main.
    await applyManualPatch(userId, projectId, {
      summary: 'Retouche manuelle',
      operations: [{ op: 'set', path: 'theme.mode', value: 'dark' }],
    })

    await expect(decidePlan(userId, projectId, outcome.plan!.id, 'apply')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('ne garde qu’une proposition en attente à la fois', async () => {
    const premiere = await editWithAgent(userId, projectId, 'rends le premier champ obligatoire')
    const seconde = await editWithAgent(userId, projectId, 'rends le premier champ obligatoire')
    expect(premiere.plan!.id).not.toBe(seconde.plan!.id)
    await expect(decidePlan(userId, projectId, premiere.plan!.id, 'apply')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })
})

describe('ce qui passe sans rien demander', () => {
  it('applique directement une modification qui n’engage pas', async () => {
    reponse.operations = [{ op: 'set', path: 'theme.mode', value: 'light' }]
    reponse.summary = 'Thème clair'
    const outcome = await editWithAgent(userId, projectId, 'mets le thème en clair')

    expect(outcome.plan).toBeUndefined()
    expect(outcome.applied).toBe(true)
    expect((await getProject(userId, projectId)).spec.theme.mode).toBe('light')
  })

  it('ne propose rien quand l’agent n’a rien changé', async () => {
    reponse.operations = []
    reponse.reply = 'Ce n’est pas possible aujourd’hui.'
    const outcome = await editWithAgent(userId, projectId, 'envoie un SMS')

    expect(outcome.plan).toBeUndefined()
    expect(outcome.applied).toBe(false)
    expect(outcome.reply).toContain('pas possible')
  })
})
