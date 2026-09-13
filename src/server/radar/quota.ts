import { AppError } from '@/lib/errors'
import { withRuntimeScope, withUserScope } from '@/server/db/scope'
import { getWallet } from '@/server/billing/credits'
import { getEffectivePlan } from '@/server/billing/plans'

/**
 * Quotas mensuels des deux modules.
 *
 * Une recherche du Radar et une réponse de Lia coûtent des crédits, mais le solde n'est pas
 * un bon garde-fou à lui seul : une offre généreuse en crédits laisserait un créateur
 * relancer le Radar vingt fois par jour, et vider son mois en une soirée. Le quota borne
 * le nombre d'usages, indépendamment du solde, et il se règle par offre depuis le
 * back-office.
 *
 * Le mois est celui du portefeuille. Plutôt qu'inventer un second cycle, on lit la date de
 * renouvellement des crédits et on compte ce qui s'est passé depuis le renouvellement
 * précédent. Un seul calendrier pour tout ce qui se compte au mois.
 */

export type Period = { start: Date; end: Date }

/** Période mensuelle courante d'une personne, alignée sur son portefeuille. */
export async function currentPeriod(userId: string): Promise<Period> {
  const wallet = await getWallet(userId)
  const end = wallet.resetsAt
  const start = new Date(end)
  start.setUTCMonth(start.getUTCMonth() - 1)
  return { start, end }
}

export type QuotaState = {
  used: number
  limit: number
  remaining: number
  /** Date à laquelle le compteur repart. */
  resetsAt: Date
}

export async function radarQuota(userId: string): Promise<QuotaState> {
  const [period, plan] = await Promise.all([currentPeriod(userId), getEffectivePlan(userId)])
  const used = await withUserScope(userId, (tx) =>
    tx.radarRun.count({ where: { userId, createdAt: { gte: period.start } } }),
  )
  const limit = plan.radarRunsPerMonth
  return { used, limit, remaining: Math.max(0, limit - used), resetsAt: period.end }
}

/** Refuse avant tout appel réseau si le quota du mois est atteint. */
export async function assertRadarQuota(userId: string): Promise<QuotaState> {
  const state = await radarQuota(userId)
  if (state.remaining <= 0) {
    throw new AppError(
      'PLAN_LIMIT',
      state.limit === 0
        ? "Le Radar n'est pas inclus dans votre offre."
        : `Vous avez utilisé vos ${state.limit} recherche${state.limit > 1 ? 's' : ''} du mois. Le compteur repart le ${state.resetsAt.toLocaleDateString('fr-CH')}.`,
      { details: { used: state.used, limit: state.limit, resetsAt: state.resetsAt.toISOString() } },
    )
  }
  return state
}

/**
 * Quota de Lia, compté par projet mais borné par l'offre du propriétaire.
 *
 * Les réponses sont comptées dans la table des messages : c'est la source de vérité, valable
 * quel que soit le serveur qui répond. Les conversations sont comptées à leur création.
 */
export type LiaQuotaState = {
  answers: QuotaState
  conversations: QuotaState
}

export async function liaQuota(ownerId: string, projectId: string): Promise<LiaQuotaState> {
  const [period, plan] = await Promise.all([currentPeriod(ownerId), getEffectivePlan(ownerId)])
  const [answers, conversations] = await withUserScope(ownerId, async (tx) =>
    Promise.all([
      tx.supportMessage.count({
        where: { projectId, role: 'lia', createdAt: { gte: period.start } },
      }),
      tx.supportConversation.count({
        where: { projectId, createdAt: { gte: period.start } },
      }),
    ]),
  )
  return {
    answers: {
      used: answers,
      limit: plan.liaAnswersPerMonth,
      remaining: Math.max(0, plan.liaAnswersPerMonth - answers),
      resetsAt: period.end,
    },
    conversations: {
      used: conversations,
      limit: plan.liaConversationsPerMonth,
      remaining: Math.max(0, plan.liaConversationsPerMonth - conversations),
      resetsAt: period.end,
    },
  }
}

/**
 * Version pour le chemin du visiteur, qui n'a pas d'identité Evoliia.
 *
 * La portée d'exécution pose l'identifiant du projet, et la politique de ces deux tables
 * laisse voir toutes les lignes du projet servi : le compte est donc complet, pas limité à
 * ce que le visiteur courant a écrit. Une lecture sans portée ne verrait rien du tout — le
 * cloisonnement est forcé, et c'est voulu.
 */
export async function liaQuotaForRuntime(
  ownerId: string,
  projectId: string,
): Promise<LiaQuotaState> {
  const [period, plan] = await Promise.all([currentPeriod(ownerId), getEffectivePlan(ownerId)])
  const [answers, conversations] = await withRuntimeScope(projectId, async (tx) =>
    Promise.all([
      tx.supportMessage.count({
        where: { projectId, role: 'lia', createdAt: { gte: period.start } },
      }),
      tx.supportConversation.count({
        where: { projectId, createdAt: { gte: period.start } },
      }),
    ]),
  )
  return {
    answers: {
      used: answers,
      limit: plan.liaAnswersPerMonth,
      remaining: Math.max(0, plan.liaAnswersPerMonth - answers),
      resetsAt: period.end,
    },
    conversations: {
      used: conversations,
      limit: plan.liaConversationsPerMonth,
      remaining: Math.max(0, plan.liaConversationsPerMonth - conversations),
      resetsAt: period.end,
    },
  }
}
