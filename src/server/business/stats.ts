import { withUserScope } from '@/server/db/scope'
import { ASSISTANT_EVENT } from '@/server/runtime/published'

/**
 * Ce que les applications d'un créateur ont réellement produit.
 *
 * Tout vient de faits enregistrés : une visite, une inscription, une fiche saisie, une
 * question posée à l'assistant. Rien n'est estimé, rien n'est extrapolé. Une application
 * qui n'a eu aucune visite affiche zéro, et c'est une information utile — bien plus qu'un
 * pourcentage flatteur calculé sur rien.
 *
 * La fenêtre est de trente jours glissants. Un total depuis toujours grossirait sans jamais
 * dire si la semaine dernière a été meilleure que la précédente.
 */

export const STATS_WINDOW_DAYS = 30

export type ProjectStats = {
  projectId: string
  views: number
  signups: number
  records: number
  assistantAnswers: number
}

export type CreatorStats = {
  windowDays: number
  byProject: Map<string, ProjectStats>
  totals: Omit<ProjectStats, 'projectId'>
}

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

/**
 * Statistiques de tous les projets d'un créateur, en quatre requêtes groupées.
 *
 * Quatre requêtes pour tous les projets plutôt que quatre par projet : un créateur avec
 * vingt applications ferait sinon quatre-vingts allers-retours pour afficher une page.
 */
export async function getCreatorStats(
  userId: string,
  projectIds: string[],
): Promise<CreatorStats> {
  const empty: CreatorStats = {
    windowDays: STATS_WINDOW_DAYS,
    byProject: new Map(),
    totals: { views: 0, signups: 0, records: 0, assistantAnswers: 0 },
  }
  if (projectIds.length === 0) return empty

  const from = since(STATS_WINDOW_DAYS)

  const [events, signups, records] = await withUserScope(userId, async (tx) => {
    return Promise.all([
      tx.appEvent.groupBy({
        by: ['projectId', 'type'],
        where: { projectId: { in: projectIds }, createdAt: { gte: from } },
        _count: { _all: true },
      }),
      tx.appEndUser.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, createdAt: { gte: from } },
        _count: { _all: true },
      }),
      tx.appRecord.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, createdAt: { gte: from } },
        _count: { _all: true },
      }),
    ])
  })

  const byProject = new Map<string, ProjectStats>(
    projectIds.map((projectId) => [
      projectId,
      { projectId, views: 0, signups: 0, records: 0, assistantAnswers: 0 },
    ]),
  )

  for (const row of events) {
    const entry = byProject.get(row.projectId)
    if (entry === undefined) continue
    if (row.type === 'view') entry.views += row._count._all
    if (row.type === ASSISTANT_EVENT) entry.assistantAnswers += row._count._all
  }
  for (const row of signups) {
    const entry = byProject.get(row.projectId)
    if (entry !== undefined) entry.signups += row._count._all
  }
  for (const row of records) {
    const entry = byProject.get(row.projectId)
    if (entry !== undefined) entry.records += row._count._all
  }

  const totals = { views: 0, signups: 0, records: 0, assistantAnswers: 0 }
  for (const entry of byProject.values()) {
    totals.views += entry.views
    totals.signups += entry.signups
    totals.records += entry.records
    totals.assistantAnswers += entry.assistantAnswers
  }

  return { windowDays: STATS_WINDOW_DAYS, byProject, totals }
}

export type SpendEntry = {
  id: string
  label: string
  delta: number
  balanceAfter: number
  createdAt: string
}

export type CreditHistory = {
  entries: SpendEntry[]
  /** Crédits dépensés sur la fenêtre, hors rechargements. */
  spentInWindow: number
  windowDays: number
}

/**
 * Traduction des motifs techniques du registre en phrases lisibles.
 *
 * Le registre enregistre `ia:generate` parce que c'est ce qui identifie l'opération dans le
 * code. Personne n'a à connaître ce vocabulaire pour comprendre où sont passés ses crédits.
 */
const REASON_LABEL: Record<string, string> = {
  'ia:ideas': 'Recherche d’idées',
  'ia:validate': 'Analyse approfondie d’une idée',
  'ia:specsheet': 'Cahier des charges',
  'ia:blueprint': 'Étude de faisabilité',
  'ia:generate': 'Construction d’une application',
  'ia:edit': 'Modification par l’assistant',
  'ia:assistant': 'Assistant d’une application publiée',
  'ia:coach': 'Question au coach',
  'ia:launchKit': 'Kit de lancement marketing',
  'grant:inscription': 'Crédits de bienvenue',
}

export function describeReason(reason: string): string {
  const known = REASON_LABEL[reason]
  if (known !== undefined) return known
  // Les recharges portent l'offre dans leur motif : « grant:mensuel:builder ».
  if (reason.startsWith('grant:mensuel')) return 'Recharge mensuelle'
  if (reason.startsWith('grant:offre')) return 'Changement d’offre'
  return reason
}

export async function getCreditHistory(userId: string, take = 6): Promise<CreditHistory> {
  const from = since(STATS_WINDOW_DAYS)
  const [rows, spent] = await Promise.all([
    withUserScope(userId, (tx) =>
      tx.creditLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, delta: true, balanceAfter: true, reason: true, createdAt: true },
      }),
    ),
    withUserScope(userId, (tx) =>
      tx.creditLedger.aggregate({
        where: { userId, createdAt: { gte: from }, delta: { lt: 0 } },
        _sum: { delta: true },
      }),
    ),
  ])

  return {
    entries: rows.map((row) => ({
      id: row.id,
      label: describeReason(row.reason),
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      createdAt: row.createdAt.toISOString(),
    })),
    spentInWindow: Math.abs(spent._sum.delta ?? 0),
    windowDays: STATS_WINDOW_DAYS,
  }
}
