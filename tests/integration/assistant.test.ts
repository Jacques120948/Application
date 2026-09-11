import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { parseAppSpec } from '@/server/spec/validate'
import { DEMO_APPS } from '@/server/demos/catalog'
import { askAppAssistant, DAILY_ANSWER_LIMIT } from '@/server/runtime/assistant'
import { ASSISTANT_EVENT } from '@/server/runtime/published'
import { AppError } from '@/lib/errors'

/**
 * Assistant intégré à une application publiée.
 *
 * Aucun appel au modèle n'est passé ici : la clé est neutralisée pendant les tests. Ce qui
 * est vérifié, c'est tout ce qui protège le portefeuille du créateur avant cet appel.
 */

let ownerId: string
let projectId: string
let email: string

const SPEC = (() => {
  const base = DEMO_APPS[0]!.spec
  return parseAppSpec({
    ...base,
    name: 'Application de test',
    pages: base.pages.map((page) =>
      page.id === 'accueil'
        ? {
            ...page,
            blocks: [
              ...page.blocks,
              {
                id: 'aide',
                type: 'assistant',
                title: 'Une question ?',
                role: "Tu réponds aux questions sur les devis d'artisans, et sur rien d'autre.",
                placeholder: 'Posez votre question',
              },
            ],
          }
        : page,
    ),
  })
})()

beforeAll(async () => {
  clearAll()
  email = `assistant-${Date.now()}@exemple.test`
  const created = await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' })
  ownerId = created.userId

  projectId = await withUserScope(ownerId, async (tx) => {
    const project = await tx.project.create({
      data: {
        ownerId,
        name: SPEC.name,
        slug: `test-assistant-${Date.now()}`,
        draftSpec: SPEC as unknown as object,
        status: 'PUBLISHED',
        locale: 'fr',
      },
      select: { id: true },
    })
    const version = await tx.projectVersion.create({
      data: {
        projectId: project.id,
        number: 1,
        label: 'Version de test',
        spec: SPEC as unknown as object,
      },
      select: { id: true },
    })
    await tx.project.update({
      where: { id: project.id },
      data: { publishedVersionId: version.id, publishedAt: new Date() },
    })
    return project.id
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('assistant d’une application', () => {
  it('refuse une section qui n’existe pas', async () => {
    await expect(
      askAppAssistant(projectId, { blockId: 'inexistant', question: 'Bonjour ?' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuse une section qui n’est pas un assistant', async () => {
    await expect(
      askAppAssistant(projectId, { blockId: 'hero', question: 'Bonjour ?' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuse une application inconnue', async () => {
    await expect(
      askAppAssistant('00000000-0000-4000-8000-000000000000', {
        blockId: 'aide',
        question: 'Bonjour ?',
      }),
    ).rejects.toBeInstanceOf(AppError)
  })

  /**
   * Le plafond est la protection principale du portefeuille du créateur : il est compté en
   * base, donc valable quel que soit le serveur qui répond.
   */
  it('se tait une fois le plafond journalier atteint', async () => {
    await withUserScope(ownerId, (tx) =>
      tx.appEvent.createMany({
        data: Array.from({ length: DAILY_ANSWER_LIMIT }, () => ({
          projectId,
          type: ASSISTANT_EVENT,
        })),
      }),
    )

    await expect(
      askAppAssistant(projectId, { blockId: 'aide', question: 'Bonjour ?' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('n’a jamais débité le créateur puisqu’aucune réponse n’a été donnée', async () => {
    const spent = await prisma.creditLedger.count({
      where: { userId: ownerId, reason: 'ia:assistant' },
    })
    expect(spent).toBe(0)
  })
})
