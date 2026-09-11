import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { DEFAULT_PLANS, FREE_PLAN_ID, getEffectivePlan } from './plans'

/**
 * Crédits IA.
 *
 * Seules les opérations coûteuses consomment des crédits (exigence 35) : génération,
 * modification assistée, diagnostic, textes marketing. Naviguer, publier, restaurer une
 * version ou saisir des données ne coûte rien.
 *
 * `CreditWallet.balance` est un cache ; la vérité est la somme de `CreditLedger`.
 */

export type CreditedOperation =
  | 'ideas'
  | 'blueprint'
  | 'generate'
  | 'edit'
  | 'diagnose'
  | 'marketing'

/** Coût plancher d'une opération, débité même si l'appel a consommé peu de jetons. */
export const MINIMUM_COST: Record<CreditedOperation, number> = {
  ideas: 5,
  blueprint: 5,
  generate: 40,
  edit: 8,
  diagnose: 15,
  marketing: 10,
}

/** 1 crédit = 1 000 micro-dollars de coût API, arrondi au supérieur. */
const MICROS_PER_CREDIT = 1_000

export function creditsForCost(operation: CreditedOperation, costMicros: number): number {
  return Math.max(MINIMUM_COST[operation], Math.ceil(costMicros / MICROS_PER_CREDIT))
}

function nextResetDate(from: Date): Date {
  const next = new Date(from)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

export async function grantInitialCredits(userId: string): Promise<void> {
  const monthly = DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)?.monthlyCredits ?? 0
  const now = new Date()
  await prisma.$transaction([
    prisma.creditWallet.create({
      data: { userId, balance: monthly, monthlyGrant: monthly, resetsAt: nextResetDate(now) },
    }),
    prisma.creditLedger.create({
      data: { userId, delta: monthly, balanceAfter: monthly, reason: 'grant:inscription' },
    }),
  ])
}

/**
 * Renvoie le portefeuille à jour, en appliquant le renouvellement mensuel si la date est
 * dépassée. Le renouvellement remet le solde à la dotation du plan : les crédits ne se
 * cumulent pas d'un mois sur l'autre, ce qui est indiqué dans l'interface.
 */
export async function getWallet(userId: string) {
  let wallet = await prisma.creditWallet.findUnique({ where: { userId } })
  if (!wallet) {
    await grantInitialCredits(userId)
    wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { userId } })
  }

  const plan = await getEffectivePlan(userId)
  const now = new Date()

  if (wallet.resetsAt <= now || wallet.monthlyGrant !== plan.monthlyCredits) {
    const renew = wallet.resetsAt <= now
    const balance = renew ? plan.monthlyCredits : wallet.balance
    wallet = await prisma.creditWallet.update({
      where: { userId },
      data: {
        balance,
        monthlyGrant: plan.monthlyCredits,
        resetsAt: renew ? nextResetDate(now) : wallet.resetsAt,
      },
    })
    if (renew) {
      await prisma.creditLedger.create({
        data: {
          userId,
          delta: balance,
          balanceAfter: balance,
          reason: `grant:mensuel:${plan.id}`,
        },
      })
    }
  }

  return wallet
}

/** Vérifie le solde AVANT tout appel réseau facturé. */
export async function ensureCredits(userId: string, operation: CreditedOperation): Promise<void> {
  const wallet = await getWallet(userId)
  if (wallet.balance < MINIMUM_COST[operation]) {
    throw new AppError(
      'INSUFFICIENT_CREDITS',
      "Vous n'avez plus assez de crédits pour cette opération. Vos crédits se renouvellent chaque mois.",
      { details: { balance: wallet.balance, required: MINIMUM_COST[operation] } },
    )
  }
}

/**
 * Débite après coup, sur la base du coût réellement observé.
 * Le solde ne descend jamais sous zéro : un dépassement est journalisé, pas facturé.
 */
export async function spendCredits(
  userId: string,
  amount: number,
  reason: string,
  projectId?: string,
): Promise<number> {
  if (amount <= 0) return (await getWallet(userId)).balance

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.creditWallet.findUniqueOrThrow({ where: { userId } })
    const spent = Math.min(amount, wallet.balance)
    if (spent < amount) {
      logger.warn('débit de crédits plafonné au solde disponible', { userId, amount, spent })
    }
    const balanceAfter = wallet.balance - spent
    await tx.creditWallet.update({ where: { userId }, data: { balance: balanceAfter } })
    await tx.creditLedger.create({
      data: {
        userId,
        delta: -spent,
        balanceAfter,
        reason,
        projectId: projectId ?? null,
      },
    })
    return balanceAfter
  })
}
