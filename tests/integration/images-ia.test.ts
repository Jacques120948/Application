import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { connectWithApiKey } from '@/server/integrations/service'
import { INTEGRATION_PROVIDERS } from '@/server/integrations/catalog'
import { addMedia, listMedias } from '@/server/media/service'
import { generationStatus, IMAGE_DAILY_LIMIT, requestImage } from '@/server/media/generate'
import { DEFAULT_THEME } from '@/server/spec/templates'
import * as openai from '@/server/integrations/providers/openai'

/**
 * Génération d'images sur une vraie base : sans clé rien ne part, avec une clé l'image
 * entre dans la bibliothèque par le chemin ordinaire, et le plafond journalier tient.
 * Le fournisseur est remplacé par un faux qui renvoie une vraie petite image.
 */

vi.mock('@/server/integrations/providers/openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/openai')>()),
  verifyOpenAiKey: vi.fn(async () => ({ ok: true, label: 'Compte OpenAI (test)' })),
  generateOpenAiImage: vi.fn(),
}))

let userId: string
let projectId: string
let png: Buffer

beforeAll(async () => {
  clearAll()
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  userId = (await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })).userId
  await prisma.subscription.create({ data: { userId, planId: 'builder', status: 'ACTIVE' } })
  projectId = await withUserScope(userId, async (tx) =>
    (
      await tx.project.create({
        data: { ownerId: userId, name: 'Atelier', slug: `ia-${randomUUID()}`, draftSpec: {}, locale: 'fr' },
        select: { id: true },
      })
    ).id,
  )
  png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#3366cc' } }).png().toBuffer()
  vi.mocked(openai.generateOpenAiImage).mockResolvedValue({ ok: true, bytes: new Uint8Array(png), mime: 'image/png' })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined)
  await prisma.$disconnect()
})

const spec = { name: 'Atelier', theme: DEFAULT_THEME }

describe('images générées avec la clé du créateur', () => {
  it('ne demande rien sans clé connectée', async () => {
    expect((await generationStatus(userId)).provider).toBeNull()
    await expect(requestImage(userId, 'Un atelier de menuiserie', spec)).rejects.toMatchObject({ code: 'UNSUPPORTED_REQUEST' })
    expect(openai.generateOpenAiImage).not.toHaveBeenCalled()
  })

  it('génère avec la clé connectée et range l’image comme un téléversement', async () => {
    expect(INTEGRATION_PROVIDERS.some((provider) => provider.id === 'openai')).toBe(true)
    await connectWithApiKey(userId, { providerId: 'openai', apiKey: 'sk-test-0123456789' })
    expect((await generationStatus(userId)).provider).toBe('openai')

    const image = await requestImage(userId, 'Un atelier de menuiserie', spec)
    expect(image.provider).toBe('openai')
    // La clé déchiffrée est passée au fournisseur, jamais renvoyée ailleurs.
    expect(vi.mocked(openai.generateOpenAiImage).mock.calls[0]?.[0]).toBe('sk-test-0123456789')
    expect(JSON.stringify(image)).not.toContain('sk-test')

    const media = await addMedia(userId, projectId, { name: 'ia.webp', bytes: image.bytes, origin: 'ai', prompt: image.prompt })
    expect(media.width).toBe(48)
    const library = await listMedias(userId, projectId)
    expect(library.items.map((item) => item.id)).toContain(media.id)
    expect(library.generation.dailyLeft).toBe(IMAGE_DAILY_LIMIT - 1)
    const stored = await withUserScope(userId, (tx) => tx.mediaAsset.findUniqueOrThrow({ where: { id: media.id }, select: { origin: true, prompt: true } }))
    expect(stored).toEqual({ origin: 'ai', prompt: 'Un atelier de menuiserie' })
  })

  it('s’arrête au plafond journalier', async () => {
    for (let index = 1; index < IMAGE_DAILY_LIMIT; index += 1) {
      await addMedia(userId, projectId, { name: `ia-${index}.png`, bytes: new Uint8Array(png), origin: 'ai', prompt: 'x' })
    }
    expect((await generationStatus(userId)).dailyLeft).toBe(0)
    await expect(requestImage(userId, 'Encore une image', spec)).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
  })

  it('marque la connexion quand le fournisseur refuse la clé', async () => {
    await withUserScope(userId, (tx) => tx.mediaAsset.deleteMany({ where: { userId, origin: 'ai' } }))
    vi.mocked(openai.generateOpenAiImage).mockResolvedValueOnce({ ok: false, kind: 'key', reason: 'OpenAI refuse votre clé.' })
    await expect(requestImage(userId, 'Une image de plus', spec)).rejects.toMatchObject({ code: 'UNSUPPORTED_REQUEST' })
    const connection = await withUserScope(userId, (tx) =>
      tx.integrationConnection.findFirstOrThrow({ where: { userId, providerId: 'openai' }, select: { status: true } }),
    )
    expect(connection.status).toBe('ERROR')
    expect((await generationStatus(userId)).provider).toBeNull()
  })
})
