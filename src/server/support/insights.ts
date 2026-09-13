import { z } from 'zod'
import { AppError, notFound } from '@/lib/errors'
import { requireOwnedProject, withUserScope } from '@/server/db/scope'
import { analyzeSupportConversations } from '@/server/ai/operations'
import { INSIGHT_KINDS } from '@/server/ai/schemas'
import { logger } from '@/server/observability/logger'
import { isEnabled } from '@/server/settings/flags'
import { notify } from '@/server/notifications/service'
import { looksAlike, fingerprint } from '@/server/radar/score'
import { assertLiaOpen } from './settings'

/**
 * Ce que les conversations révèlent (Lia V2).
 *
 * Une analyse par lot, à la demande du créateur, jamais en continu : elle coûte des
 * crédits, et elle lit des messages de visiteurs. Le modèle rend des thèmes reformulés,
 * pas des citations ; ce qui est stocké est ce qu'il rend. Une lacune (« sans réponse »)
 * est l'entrée de base de connaissances qui manque : c'est le lien le plus utile de ce
 * module, de la question posée à la réponse à écrire.
 */

export const INSIGHTS_ESTIMATED_CREDITS = 3
export const INSIGHT_STATUSES = ['new', 'roadmap', 'dismissed'] as const

export const insightUpdate = z.object({
  id: z.string().uuid(),
  status: z.enum(INSIGHT_STATUSES),
})

export type InsightView = {
  id: string
  kind: (typeof INSIGHT_KINDS)[number]
  title: string
  count: number
  examples: string[]
  status: (typeof INSIGHT_STATUSES)[number]
  lastSeenAt: string
  createdAt: string
}

function toView(row: {
  id: string
  kind: string
  title: string
  count: number
  examples: unknown
  status: string
  lastSeenAt: Date
  createdAt: Date
}): InsightView {
  return {
    id: row.id,
    kind: INSIGHT_KINDS.find((k) => k === row.kind) ?? 'frequent_question',
    title: row.title,
    count: row.count,
    examples: Array.isArray(row.examples) ? row.examples.filter((e): e is string => typeof e === 'string') : [],
    status: INSIGHT_STATUSES.find((s) => s === row.status) ?? 'new',
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

async function assertV2(ownerId: string): Promise<void> {
  await assertLiaOpen(ownerId)
  if (!(await isEnabled('liaV2'))) {
    throw new AppError('UNSUPPORTED_REQUEST', "L'analyse des conversations n'est pas encore ouverte.")
  }
}

export async function listInsights(ownerId: string, projectId: string): Promise<InsightView[]> {
  const rows = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    return tx.supportInsight.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { count: 'desc' }, { lastSeenAt: 'desc' }],
      take: 100,
    })
  })
  return rows.map(toView)
}

export async function generateInsights(
  ownerId: string,
  projectId: string,
  locale: string,
): Promise<{ insights: InsightView[]; creditsSpent: number; analyzed: number }> {
  await assertV2(ownerId)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const conversations = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    return tx.supportConversation.findMany({
      where: { projectId, createdAt: { gte: since } },
      orderBy: { lastMessageAt: 'desc' },
      take: 60,
      include: {
        messages: { where: { role: { in: ['visitor', 'lia'] } }, orderBy: { createdAt: 'asc' }, take: 8, select: { role: true, content: true, grounded: true } },
      },
    })
  })
  if (conversations.length === 0) {
    throw new AppError('VALIDATION', 'Aucune conversation à analyser sur les trente derniers jours.')
  }

  const transcript = conversations
    .map((conversation, index) => {
      const lines = conversation.messages.map((m) =>
        m.role === 'visitor'
          ? `V : ${m.content.slice(0, 300)}`
          : `L : ${m.grounded ? '(a répondu depuis la base)' : '(n’a pas su répondre)'}`,
      )
      return [`Conversation ${index + 1}${conversation.status === 'escalated' ? ' (transmise)' : ''}`, ...lines].join('\n')
    })
    .join('\n\n')

  const result = await analyzeSupportConversations(ownerId, projectId, transcript, locale)

  const rows = await withUserScope(ownerId, async (tx) => {
    const existing = await tx.supportInsight.findMany({ where: { projectId, status: { not: 'dismissed' } } })
    for (const insight of result.value.insights) {
      const same = existing.find(
        (row) => row.kind === insight.kind && looksAlike(fingerprint(row.title, ''), fingerprint(insight.title, '')),
      )
      if (same !== undefined) {
        await tx.supportInsight.update({
          where: { id: same.id },
          data: { count: Math.max(same.count, insight.count), examples: insight.examples, lastSeenAt: new Date() },
        })
      } else {
        await tx.supportInsight.create({
          data: { userId: ownerId, projectId, kind: insight.kind, title: insight.title, count: insight.count, examples: insight.examples },
        })
      }
    }
    return tx.supportInsight.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { count: 'desc' }, { lastSeenAt: 'desc' }],
      take: 100,
    })
  })

  const unanswered = result.value.insights.filter((i) => i.kind === 'unanswered').length
  if (unanswered > 0) {
    await notify(ownerId, {
      kind: 'support_insight',
      title: `${unanswered} lacune${unanswered > 1 ? 's' : ''} dans la base de connaissances`,
      body: result.value.insights.filter((i) => i.kind === 'unanswered').map((i) => i.title).join(' · '),
      href: `/${locale}/projets/${projectId}?onglet=support`,
    })
  }
  logger.info('lia : analyse effectuée', { userId: ownerId, projectId, analyzed: conversations.length, insights: result.value.insights.length })
  return { insights: rows.map(toView), creditsSpent: result.creditsSpent, analyzed: conversations.length }
}

export async function setInsightStatus(
  ownerId: string,
  projectId: string,
  input: z.infer<typeof insightUpdate>,
): Promise<InsightView> {
  const row = await withUserScope(ownerId, async (tx) => {
    const found = await tx.supportInsight.findFirst({ where: { id: input.id, projectId, userId: ownerId }, select: { id: true } })
    if (found === null) throw notFound("Cette analyse n'existe pas.")
    return tx.supportInsight.update({ where: { id: input.id }, data: { status: input.status } })
  })
  return toView(row)
}

export { builderRequestFor } from '@/lib/support'
