import type { CreditMovement } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { creditsFor, loadPricing } from './ai-pricing'
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
  /** Une recherche du Radar : cinq opportunités structurées et expliquées. */
  | 'radar'
  /** La synthèse d'une comparaison entre deux ou trois opportunités. */
  | 'radarCompare'
  /** Une réponse de Lia à un visiteur, payée par le créateur de l'application. */
  | 'liaAnswer'
  /** Une FAQ proposée depuis l'application, à relire avant publication. */
  | 'liaFaq'
  /** Analyse par lot des conversations : ce que les clients demandent (V2). */
  | 'liaInsights'
  /** Une image créée par l'IA sur le compte d'Evoliia, refacturée à son créateur. */
  | 'image'
  /**
   * Des corrections rédigées pour un constat d'audit : titres, descriptions, introductions.
   *
   * C'est la première dépense réelle du produit de visibilité, et la seule. Explorer un
   * site, appliquer les contrôles et calculer les deux notes est du calcul : rien n'est
   * appelé, rien n'est facturé. Les crédits ne partent que lorsqu'un modèle écrit.
   */
  | 'visibilityFix'
  /** Une question posée à l'un des quatre spécialistes de la visibilité. */
  | 'visibilityAsk'

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
  /*
   * Le Radar produit cinq opportunités structurées avec leurs raisons : c'est le même
   * ordre de grandeur qu'une recherche d'idées, dont il est l'héritier.
   */
  radar: 3,
  radarCompare: 2,
  /*
   * Une réponse de Lia est courte et fondée sur une entrée retrouvée : le plancher est
   * celui de l'assistant qu'elle prolonge. Le vrai garde-fou est le quota mensuel de
   * l'offre, pas ce plancher.
   */
  liaAnswer: 1,
  liaFaq: 3,
  liaInsights: 3,
  /*
   * Une image a un prix ferme chez le fournisseur : il n'y a pas de « petit appel » à
   * protéger d'un plancher trop haut, ni de gros à laisser filer. Le plancher vaut donc
   * un, et c'est le coût réel — lu dans le tarif réglable — qui décide.
   */
  image: 1,
  /*
   * Une correction porte sur quelques pages à la fois et rend, pour chacune, une ou deux
   * phrases. C'est l'ordre de grandeur d'une variation de contenu : le plancher est le même,
   * et c'est le coût réel des jetons qui décide au-delà.
   */
  visibilityFix: 2,
  /*
   * Une question à un spécialiste : le contexte est un extrait de faits mesurés, la réponse
   * fait six phrases. Même ordre de grandeur qu'un spécialiste marketing, dont elle reprend
   * la forme.
   */
  visibilityAsk: 2,
}

/**
 * Crédits dus pour un coût observé.
 *
 * L'unité de conversion et la marge ne sont plus écrites ici : elles se règlent depuis
 * l'administration (voir `ai-pricing.ts`), avec pour valeurs de départ exactement celles
 * qui s'appliquaient auparavant. Le plancher de l'opération, lui, reste dans le code :
 * il dit ce qu'une opération coûte au minimum à Evoliia, ce qui est une donnée technique
 * et non un choix commercial.
 */
export async function creditsForCost(
  operation: CreditedOperation,
  costMicros: number,
): Promise<number> {
  return creditsFor(costMicros, MINIMUM_COST[operation], await loadPricing())
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
      data: {
        userId,
        delta: monthly,
        balanceAfter: monthly,
        reason: 'grant:inscription',
        type: 'SUBSCRIPTION_CREDIT',
      },
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
          type: 'SUBSCRIPTION_CREDIT',
        },
      })
    }
  }

  return wallet
}

/**
 * Vérifie le solde AVANT tout appel réseau facturé.
 *
 * Regarde le disponible et non le solde brut : une opération déjà en cours a mis ses
 * crédits de côté, et les compter deux fois autoriserait un dépassement.
 */
export async function ensureCredits(userId: string, operation: CreditedOperation): Promise<void> {
  const balance = await availableCredits(userId)
  if (balance < MINIMUM_COST[operation]) {
    throw new AppError(
      'INSUFFICIENT_CREDITS',
      "Vous n'avez plus assez de crédits pour cette opération. Vos crédits se renouvellent chaque mois.",
      { details: { balance, required: MINIMUM_COST[operation] } },
    )
  }
}

/**
 * Débite après coup, sur la base du coût réellement observé.
 * Le solde ne descend jamais sous zéro : un dépassement est journalisé, pas facturé.
 */
/**
 * Type d'un mouvement, déduit de son motif.
 *
 * Les motifs suivent une convention stable depuis l'origine (`ia:`, `grant:`), et
 * l'historique déjà écrit a été reclassé par la migration selon la même règle. La déduire
 * plutôt que l'exiger à chaque appel évite qu'un oubli à un seul endroit reclasse un
 * débit d'IA en correction manuelle.
 */
export function movementFor(reason: string): CreditMovement {
  if (reason.startsWith('ia:')) return 'AI_USAGE'
  if (reason.startsWith('grant:')) return 'SUBSCRIPTION_CREDIT'
  if (reason.startsWith('achat:')) return 'CREDIT_PURCHASE'
  if (reason.startsWith('remboursement:')) return 'REFUND'
  return 'ADJUSTMENT'
}

export type SpendDetails = {
  /** L'appel au modèle qui a provoqué ce débit, quand il y en a un. */
  aiUsageId?: string | undefined
  type?: CreditMovement | undefined
}

export async function spendCredits(
  userId: string,
  amount: number,
  reason: string,
  projectId?: string,
  details: SpendDetails = {},
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
        type: details.type ?? movementFor(reason),
        projectId: projectId ?? null,
        aiUsageId: details.aiUsageId ?? null,
      },
    })
    return balanceAfter
  })
}

/**
 * Le solde disponible : le solde, moins ce que les opérations en cours ont mis de côté.
 *
 * C'est ce nombre qu'il faut regarder avant d'autoriser une opération. Le solde brut ment
 * dès que deux opérations tournent en même temps : chacune y lirait la totalité.
 */
export async function availableCredits(userId: string): Promise<number> {
  const wallet = await getWallet(userId)
  const held = await prisma.creditReservation.aggregate({
    where: { userId, releasedAt: null, expiresAt: { gt: new Date() } },
    _sum: { amount: true },
  })
  return Math.max(0, wallet.balance - (held._sum.amount ?? 0))
}
