import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEMO_APPS } from '@/server/demos/catalog'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { availableCredits, getWallet } from '@/server/billing/credits'
import { forgetPricingCache, PRICING_SETTINGS } from '@/server/billing/ai-pricing'
import { writeSetting } from '@/server/settings/store'

/**
 * Images créées sur le compte d'Evoliia.
 *
 * C'est la première fonction où la plateforme dépense réellement de l'argent pour un
 * créateur — jusqu'ici, tout ce qui coûtait passait par la clé du créateur ou par des
 * jetons déjà mesurés. Quatre propriétés méritent donc d'être tenues par un test, et
 * chacune répond à une façon de perdre de l'argent ou la confiance.
 *
 * **La clé du créateur passe avant.** Elle ne coûte rien à Evoliia. L'oublier ferait payer
 * la plateforme pour des créateurs qui avaient déjà de quoi payer.
 *
 * **Sans quota d'offre, rien ne part.** Zéro par défaut : la fonction s'ouvre offre par
 * offre, jamais toute seule.
 *
 * **Le quota ne compte que ce qu'Evoliia a payé.** Confondre les deux origines ferait
 * consommer au créateur autonome un quota dont il ne prend rien.
 *
 * **Les crédits sont débités au tarif en vigueur**, réglable depuis l'administration — et
 * jamais quand le fournisseur a refusé, puisque rien n'a alors été facturé à Evoliia.
 */

const FAUSSE_IMAGE = { ok: true as const, bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
const generateGeminiImage = vi.fn(async () => FAUSSE_IMAGE as never)

vi.mock('@/server/integrations/providers/gemini', () => ({
  GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',
  generateGeminiImage: (...args: unknown[]) => generateGeminiImage(...(args as [])),
  verifyGeminiKey: async () => ({ ok: true, label: 'Compte Google AI' }),
}))

let userId: string
let email: string
const spec = DEMO_APPS[0]!.spec

async function offreAvecImages(images: number): Promise<void> {
  await prisma.plan.update({ where: { id: 'free' }, data: { imagesPerMonth: images } })
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
  email = `images-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  // De quoi payer : une image coûte environ huit crédits.
  await getWallet(userId)
  await prisma.creditWallet.update({ where: { userId }, data: { balance: 200 } })
}, 60_000)

afterEach(() => {
  generateGeminiImage.mockClear()
  forgetPricingCache()
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
  await prisma.plan.update({ where: { id: 'free' }, data: { imagesPerMonth: 0 } })
  await prisma.siteSetting.deleteMany({ where: { key: PRICING_SETTINGS.imageMicros } })
  delete process.env.GEMINI_API_KEY
  forgetPricingCache()
})

describe('ce qui est ouvert, et à qui', () => {
  it('reste fermé sans clé Evoliia, même avec un quota', async () => {
    delete process.env.GEMINI_API_KEY
    await offreAvecImages(10)
    const { generationStatus } = await import('@/server/media/generate')

    // La fonction est éteinte, pas à moitié branchée : le créateur ne voit rien qui
    // promette une image que le serveur ne saurait pas produire.
    expect((await generationStatus(userId)).source).toBeNull()
  })

  it('reste fermé quand l’offre n’accorde aucune image', async () => {
    process.env.GEMINI_API_KEY = 'AIza-cle-de-test'
    await offreAvecImages(0)
    const { generationStatus, requestImage } = await import('@/server/media/generate')

    expect((await generationStatus(userId)).source).toBeNull()
    await expect(requestImage(userId, 'un atelier de menuiserie', spec)).rejects.toThrow(
      /offre ne comprend pas/i,
    )
    expect(generateGeminiImage).not.toHaveBeenCalled()
  })

  it('s’ouvre offre par offre, et annonce son prix', async () => {
    process.env.GEMINI_API_KEY = 'AIza-cle-de-test'
    await offreAvecImages(5)
    const { generationStatus } = await import('@/server/media/generate')

    const status = await generationStatus(userId)
    expect(status.source).toBe('evoliia')
    expect(status.monthlyLimit).toBe(5)
    // 39 000 micro-dollars pour 5 000 par crédit : huit crédits l'image.
    expect(status.creditsPerImage).toBe(8)
  })

  it('suit le tarif réglé depuis l’administration', async () => {
    process.env.GEMINI_API_KEY = 'AIza-cle-de-test'
    await offreAvecImages(5)
    await writeSetting(PRICING_SETTINGS.imageMicros, '100000')
    forgetPricingCache()
    const { creditsPerImage } = await import('@/server/media/generate')

    // Le jour où Google change son prix est celui où il ne faut pas avoir à déployer.
    expect(await creditsPerImage()).toBe(20)

    await prisma.siteSetting.deleteMany({ where: { key: PRICING_SETTINGS.imageMicros } })
    forgetPricingCache()
  })
})

describe('ce que coûte une image', () => {
  it('débite les crédits, et décompte le quota du mois', async () => {
    process.env.GEMINI_API_KEY = 'AIza-cle-de-test'
    await offreAvecImages(5)
    const { generationStatus, requestImage } = await import('@/server/media/generate')
    const { addMedia } = await import('@/server/media/service')

    const avant = await availableCredits(userId)
    const image = await requestImage(userId, 'un atelier de menuiserie baigné de lumière', spec)

    expect(image.source).toBe('evoliia')
    expect(image.creditsSpent).toBe(8)
    expect(await availableCredits(userId)).toBe(avant - 8)

    // La consommation est enregistrée : c'est la seule trace qui permette de mesurer la
    // marge réelle d'Evoliia sur les images.
    const usage = await prisma.aiUsage.findFirst({
      where: { userId, operation: 'image' },
      orderBy: { createdAt: 'desc' },
    })
    expect(usage).toMatchObject({ model: 'gemini-2.5-flash-image', creditsSpent: 8, success: true })

    // Le quota ne bouge qu'une fois l'image rangée : c'est l'enregistrement qui compte,
    // pas l'appel.
    expect((await generationStatus(userId)).monthlyLeft).toBe(5)
    await prisma.plan.update({ where: { id: 'free' }, data: { storageBytes: 1024 * 1024 } })
    const projet = await withUserScope(userId, (tx) =>
      tx.project.create({
        data: {
          ownerId: userId,
          name: 'Projet',
          slug: `images-${Math.random().toString(36).slice(2, 10)}`,
          idea: 'une idée',
          draftSpec: spec as unknown as object,
        },
        select: { id: true },
      }),
    )
    await addMedia(userId, projet.id, {
      name: 'ia.webp',
      bytes: await vraieImage(),
      origin: 'ai-evoliia',
    })
    expect((await generationStatus(userId)).monthlyLeft).toBe(4)

    // Une image payée par le créateur sur son propre compte ne prend rien de ce quota.
    await addMedia(userId, projet.id, { name: 'sienne.webp', bytes: await vraieImage(), origin: 'ai' })
    expect((await generationStatus(userId)).monthlyLeft).toBe(4)
  })

  it('ne débite rien quand le fournisseur refuse', async () => {
    process.env.GEMINI_API_KEY = 'AIza-cle-de-test'
    await offreAvecImages(5)
    generateGeminiImage.mockResolvedValueOnce({
      ok: false,
      kind: 'unavailable',
      reason: 'Google ne répond pas.',
    } as never)
    const { requestImage } = await import('@/server/media/generate')

    const avant = await availableCredits(userId)
    await expect(requestImage(userId, 'un atelier de menuiserie', spec)).rejects.toThrow(
      /Rien ne vous a été débité/i,
    )
    // Evoliia n'a rien été facturée : le créateur ne doit rien payer non plus. Et la
    // réservation doit être rendue, sans quoi le solde disponible resterait amputé.
    expect(await availableCredits(userId)).toBe(avant)
  })
})

/** Une vraie image : `addMedia` refuse ce qui n'en est pas une, et c'est son rôle. */
async function vraieImage(): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default
  const buffer = await sharp({
    create: { width: 60, height: 40, channels: 3, background: { r: 10, g: 10, b: 10 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}
