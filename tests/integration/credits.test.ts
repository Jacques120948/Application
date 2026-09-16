import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { availableCredits, getWallet, movementFor, spendCredits } from '@/server/billing/credits'
import {
  releaseReservation,
  reserveCredits,
  sweepExpiredReservations,
} from '@/server/billing/reservation'
import {
  DEFAULT_MICROS_PER_CREDIT,
  forgetPricingCache,
  loadPricing,
  PRICING_SETTINGS,
} from '@/server/billing/ai-pricing'
import { AppError } from '@/lib/errors'

/**
 * Crédits : réservation, débit, journal.
 *
 * Sur une vraie base, parce que c'est là que se joue ce qui compte : deux opérations
 * lancées ensemble ne doivent pas pouvoir dépenser deux fois le même solde, et un
 * processus interrompu ne doit pas geler des crédits pour toujours.
 */

let userId: string
let email: string

async function setBalance(balance: number): Promise<void> {
  await prisma.creditWallet.update({ where: { userId }, data: { balance } })
}

beforeAll(async () => {
  clearAll()
  email = `credits-${Date.now()}@exemple.test`
  const created = await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' })
  userId = created.userId
  await getWallet(userId)
}, 30_000)

beforeEach(async () => {
  await prisma.creditReservation.deleteMany({ where: { userId } })
  await setBalance(1_000)
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('réservation', () => {
  it('retire les crédits du disponible sans toucher au solde', async () => {
    await reserveCredits({ userId, operation: 'generate', amount: 100 })
    expect(await availableCredits(userId)).toBe(900)
    // Le solde affiché ne bouge pas pendant l'opération : il ne descendra qu'au débit.
    expect((await prisma.creditWallet.findUniqueOrThrow({ where: { userId } })).balance).toBe(1_000)
  })

  it('refuse quand le disponible ne suffit plus, même si le solde paraît suffisant', async () => {
    await reserveCredits({ userId, operation: 'generate', amount: 950 })
    await expect(reserveCredits({ userId, operation: 'generate', amount: 100 })).rejects.toMatchObject(
      { code: 'INSUFFICIENT_CREDITS' },
    )
  })

  it('ne laisse pas deux opérations simultanées dépenser le même solde', async () => {
    await setBalance(120)
    const résultats = await Promise.allSettled([
      reserveCredits({ userId, operation: 'generate', amount: 100 }),
      reserveCredits({ userId, operation: 'generate', amount: 100 }),
    ])
    const acceptées = résultats.filter((issue) => issue.status === 'fulfilled')
    const refusées = résultats.filter((issue) => issue.status === 'rejected')
    expect(acceptées).toHaveLength(1)
    expect(refusées).toHaveLength(1)
    expect((refusées[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppError)
  })

  it('rend les crédits dès que la réservation est libérée', async () => {
    const reservation = await reserveCredits({ userId, operation: 'edit', amount: 40 })
    expect(await availableCredits(userId)).toBe(960)
    await releaseReservation(reservation.id)
    expect(await availableCredits(userId)).toBe(1_000)
  })

  it('ne gèle rien après l’échéance, même sans libération', async () => {
    const reservation = await reserveCredits({ userId, operation: 'edit', amount: 40 })
    await prisma.creditReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    expect(await availableCredits(userId)).toBe(1_000)
    expect(await sweepExpiredReservations()).toBeGreaterThan(0)
  })
})

describe('journal des mouvements', () => {
  it('classe un débit d’IA et garde son motif', async () => {
    const before = await prisma.creditLedger.count({ where: { userId } })
    await spendCredits(userId, 30, 'ia:generate')
    const entries = await prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    expect(await prisma.creditLedger.count({ where: { userId } })).toBe(before + 1)
    expect(entries[0]?.type).toBe('AI_USAGE')
    expect(entries[0]?.delta).toBe(-30)
    expect(entries[0]?.balanceAfter).toBe(970)
  })

  it('déduit le type du motif', () => {
    expect(movementFor('ia:edit')).toBe('AI_USAGE')
    expect(movementFor('grant:mensuel:launch')).toBe('SUBSCRIPTION_CREDIT')
    expect(movementFor('achat:pack-1000')).toBe('CREDIT_PURCHASE')
    expect(movementFor('remboursement:pack-1000')).toBe('REFUND')
    expect(movementFor('quelque chose')).toBe('ADJUSTMENT')
  })

  it('rattache un débit à l’appel qui l’a causé', async () => {
    const usage = await prisma.aiUsage.create({
      data: { userId, operation: 'edit', model: 'claude-sonnet-5', costMicros: 4_000 },
      select: { id: true },
    })
    await spendCredits(userId, 2, 'ia:edit', undefined, { aiUsageId: usage.id })
    const entry = await prisma.creditLedger.findFirst({
      where: { userId, aiUsageId: usage.id },
    })
    expect(entry).not.toBeNull()
  })

  it('refuse qu’un même paiement crédite deux fois', async () => {
    const paiement = `pi_test_${randomUUID()}`
    const wallet = await getWallet(userId)
    await prisma.creditLedger.create({
      data: {
        userId,
        delta: 1_000,
        balanceAfter: wallet.balance + 1_000,
        reason: 'achat:pack',
        type: 'CREDIT_PURCHASE',
        stripePaymentId: paiement,
      },
    })
    await expect(
      prisma.creditLedger.create({
        data: {
          userId,
          delta: 1_000,
          balanceAfter: wallet.balance + 2_000,
          reason: 'achat:pack',
          type: 'CREDIT_PURCHASE',
          stripePaymentId: paiement,
        },
      }),
    ).rejects.toThrow()
  })
})

describe('tarifs réglables', () => {
  beforeEach(() => forgetPricingCache())
  afterAll(async () => {
    await prisma.siteSetting.deleteMany({ where: { key: PRICING_SETTINGS.multiplier } })
    forgetPricingCache()
  })

  it('applique les valeurs du code tant que rien n’est réglé', async () => {
    await prisma.siteSetting.deleteMany({ where: { key: PRICING_SETTINGS.multiplier } })
    forgetPricingCache()
    const table = await loadPricing()
    expect(table.multiplier).toBe(1)
    expect(table.microsPerCredit).toBe(DEFAULT_MICROS_PER_CREDIT)
  })

  it('lit la marge réglée depuis l’administration', async () => {
    await prisma.siteSetting.upsert({
      where: { key: PRICING_SETTINGS.multiplier },
      update: { value: '2.5' },
      create: { key: PRICING_SETTINGS.multiplier, value: '2.5' },
    })
    forgetPricingCache()
    expect((await loadPricing()).multiplier).toBe(2.5)
  })

  it('ignore une marge absurde plutôt que de facturer zéro', async () => {
    await prisma.siteSetting.upsert({
      where: { key: PRICING_SETTINGS.multiplier },
      update: { value: 'gratuit' },
      create: { key: PRICING_SETTINGS.multiplier, value: 'gratuit' },
    })
    forgetPricingCache()
    expect((await loadPricing()).multiplier).toBe(1)
  })
})
