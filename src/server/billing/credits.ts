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

/**
 * Opérations réellement implémentées. Le diagnostic automatique et la génération de
 * textes marketing arrivent en phase 4 : ils ne sont pas déclarés ici tant qu'ils
 * n'existent pas.
 */
export type CreditedOperation =
  | 'ideas'
  | 'validate'
  | 'specsheet'
  | 'blueprint'
  | 'generate'
  | 'edit'
  /** Réponse de l'assistant intégré à une application, payée par son créateur. */
  | 'assistant'
  /** Réponse du coach qui accompagne le créateur dans Evoliia. */
  | 'coach'
  /** Kit de lancement marketing, produit par le moteur social. */
  | 'launchKit'
  /** Une semaine réécrite, déclinée ou adaptée à un autre réseau. */
  | 'contentVariation'
  /** Un mois de publications, plutôt qu'une semaine. */
  | 'monthlyPlan'
  /** Une question posée à l'un des trois spécialistes marketing. */
  | 'specialist'

/** Coût plancher d'une opération, débité même si l'appel a consommé peu de jetons. */
export const MINIMUM_COST: Record<CreditedOperation, number> = {
  ideas: 3,
  validate: 5,
  specsheet: 5,
  blueprint: 2,
  generate: 20,
  edit: 2,
  assistant: 1,
  coach: 1,
  /*
   * Plancher seulement. Le coût réel observé sur un premier kit complet est de 11 crédits,
   * soit environ 0,055 USD : la sortie fait près de 5 000 jetons, le double de ce qui
   * avait été estimé avant mesure. Le plancher reste bas pour ne pas surfacturer un kit
   * court ; c'est LAUNCH_KIT_ESTIMATED_CREDITS qui est annoncé au créateur.
   */
  launchKit: 5,
  /*
   * Une variation reprend une publication existante et la réécrit : l'entrée est courte,
   * la sortie aussi. Le plancher est celui d'une opération cadrée par le schéma.
   */
  contentVariation: 2,
  /*
   * Un mois est environ quatre fois une semaine. Le kit complet coûte 11 crédits mesurés,
   * dont la semaine n'est qu'une part : le plancher est posé à 12 et le coût réel, comme
   * partout, est celui des jetons effectivement consommés.
   */
  monthlyPlan: 12,
  /*
   * Une question à un spécialiste. Le contexte est un extrait de faits, la réponse fait six
   * phrases : c'est plus qu'une réponse de coach, moins qu'une génération.
   */
  specialist: 2,
}

/**
 * 1 crédit = 5 000 micro-dollars de coût API, arrondi au supérieur.
 *
 * Cette unité n'est pas arbitraire : elle est choisie pour que le modèle tarifaire de
 * référence tienne debout. Construire une application coûte environ 0,105 USD, soit 21
 * crédits ; l'offre Launch en accorde 100 par mois. Changer l'unité ici recalibre tout le
 * système sans toucher à la mécanique.
 */
const MICROS_PER_CREDIT = 5_000

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

  const renew = wallet.resetsAt <= now
  // Un changement d'offre vers le haut donne accès aux crédits immédiatement : faire
  // attendre le renouvellement mensuel après un paiement serait incompréhensible.
  const upgrade = !renew && plan.monthlyCredits > wallet.monthlyGrant

  if (renew || upgrade || wallet.monthlyGrant !== plan.monthlyCredits) {
    const balance = renew
      ? plan.monthlyCredits
      : upgrade
        ? Math.max(wallet.balance, plan.monthlyCredits)
        : wallet.balance
    const previousBalance = wallet.balance

    wallet = await prisma.creditWallet.update({
      where: { userId },
      data: {
        balance,
        monthlyGrant: plan.monthlyCredits,
        resetsAt: renew ? nextResetDate(now) : wallet.resetsAt,
      },
    })

    if (balance !== previousBalance) {
      await prisma.creditLedger.create({
        data: {
          userId,
          delta: balance - previousBalance,
          balanceAfter: balance,
          reason: renew ? `grant:mensuel:${plan.id}` : `grant:offre:${plan.id}`,
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
