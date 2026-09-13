import { z } from 'zod'
import { notFound } from '@/lib/errors'
import { requireOwnedProject, withUserScope } from '@/server/db/scope'
import { isEmailAvailable, sendEmail } from '@/server/email/send'
import { logger } from '@/server/observability/logger'
import { liaQuota, type LiaQuotaState } from '@/server/radar/quota'
import { SUPPORT_CATEGORIES } from '@/server/ai/schemas'
import { getSupportSettings, liaAccess, type SupportSettingsView } from './settings'
import type { MessageView } from './conversation'

/**
 * Lia côté créateur : ce que ses utilisateurs ont demandé, ce que Lia a répondu, ce qui
 * lui a été transmis. Tout passe par sa portée : il ne voit que ses applications, et la
 * politique de la base le garantit même si ce code se trompait.
 */

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
export const CONVERSATION_STATUSES = ['open', 'escalated', 'closed'] as const

export const ticketUpdate = z.object({
  id: z.string().uuid(),
  status: z.enum(TICKET_STATUSES).optional(),
  category: z.enum(SUPPORT_CATEGORIES).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
})

export const ticketReply = z.object({
  id: z.string().uuid(),
  content: z.string().trim().min(1).max(2000),
})

export type ConversationSummary = {
  id: string
  status: (typeof CONVERSATION_STATUSES)[number]
  category: string | null
  messageCount: number
  answeredCount: number
  satisfaction: number | null
  /** Premier message du visiteur, tronqué. */
  preview: string
  hasAccount: boolean
  lastMessageAt: string
  createdAt: string
}

export type TicketView = {
  id: string
  conversationId: string | null
  email: string | null
  subject: string
  category: string
  priority: string
  status: (typeof TICKET_STATUSES)[number]
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export type SupportOverview = {
  access: Awaited<ReturnType<typeof liaAccess>>
  settings: SupportSettingsView
  quota: LiaQuotaState
  stats: {
    conversations: number
    answers: number
    grounded: number
    escalated: number
    openTickets: number
    thumbsUp: number
    thumbsDown: number
    categories: Array<{ category: string; count: number }>
  }
  knowledge: { published: number; draft: number; disabled: number }
}

function thirtyDaysAgo(): Date {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
}

/**
 * Efface ce qui a dépassé la durée de conservation. Une conversation liée à un ticket
 * encore ouvert reste, le temps que le créateur le traite.
 */
export async function purgeExpired(ownerId: string, projectId: string, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const deleted = await withUserScope(ownerId, (tx) =>
    tx.supportConversation.deleteMany({
      where: {
        userId: ownerId,
        projectId,
        createdAt: { lt: cutoff },
        tickets: { none: { status: { in: ['open', 'in_progress'] } } },
      },
    }),
  )
  if (deleted.count > 0) logger.info('lia : conversations expirées effacées', { projectId, count: deleted.count })
  return deleted.count
}

export async function getSupportOverview(ownerId: string, projectId: string): Promise<SupportOverview> {
  const [access, settings] = await Promise.all([liaAccess(ownerId), getSupportSettings(ownerId, projectId)])
  await purgeExpired(ownerId, projectId, settings.retentionDays)
  const since = thirtyDaysAgo()

  const quota = await liaQuota(ownerId, projectId)
  const counts = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    const [conversations, answers, grounded, escalated, openTickets, thumbsUp, thumbsDown, byCategory, knowledge] =
      await Promise.all([
        tx.supportConversation.count({ where: { projectId, createdAt: { gte: since } } }),
        tx.supportMessage.count({ where: { projectId, role: 'lia', createdAt: { gte: since } } }),
        tx.supportMessage.count({ where: { projectId, role: 'lia', grounded: true, createdAt: { gte: since } } }),
        tx.supportConversation.count({ where: { projectId, status: 'escalated', createdAt: { gte: since } } }),
        tx.supportTicket.count({ where: { projectId, status: { in: ['open', 'in_progress'] } } }),
        tx.supportConversation.count({ where: { projectId, satisfaction: 1, createdAt: { gte: since } } }),
        tx.supportConversation.count({ where: { projectId, satisfaction: -1, createdAt: { gte: since } } }),
        tx.supportConversation.groupBy({
          by: ['category'],
          where: { projectId, createdAt: { gte: since }, category: { not: null } },
          _count: { _all: true },
        }),
        tx.supportKnowledgeEntry.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true } }),
      ])
    return { conversations, answers, grounded, escalated, openTickets, thumbsUp, thumbsDown, byCategory, knowledge }
  })
  const { conversations, answers, grounded, escalated, openTickets, thumbsUp, thumbsDown, byCategory, knowledge } = counts

  const count = (status: string) => knowledge.find((row) => row.status === status)?._count._all ?? 0
  return {
    access,
    settings,
    quota,
    stats: {
      conversations,
      answers,
      grounded,
      escalated,
      openTickets,
      thumbsUp,
      thumbsDown,
      categories: byCategory
        .map((row) => ({ category: row.category ?? 'other', count: row._count._all }))
        .sort((a, b) => b.count - a.count),
    },
    knowledge: { published: count('published'), draft: count('draft'), disabled: count('disabled') },
  }
}

export async function listConversations(
  ownerId: string,
  projectId: string,
  filter: { status?: (typeof CONVERSATION_STATUSES)[number] } = {},
): Promise<ConversationSummary[]> {
  const rows = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    return tx.supportConversation.findMany({
      where: { projectId, ...(filter.status === undefined ? {} : { status: filter.status }) },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        messages: { where: { role: 'visitor' }, orderBy: { createdAt: 'asc' }, take: 1, select: { content: true } },
      },
    })
  })
  return rows.map((row) => ({
    id: row.id,
    status: row.status === 'escalated' ? 'escalated' : row.status === 'closed' ? 'closed' : 'open',
    category: row.category,
    messageCount: row.messageCount,
    answeredCount: row.answeredCount,
    satisfaction: row.satisfaction,
    preview: (row.messages[0]?.content ?? '').slice(0, 140),
    hasAccount: row.endUserId !== null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function getConversation(
  ownerId: string,
  projectId: string,
  id: string,
): Promise<{ conversation: ConversationSummary; messages: MessageView[]; endUserEmail: string | null }> {
  const row = await withUserScope(ownerId, (tx) =>
    tx.supportConversation.findFirst({
      where: { id, projectId, userId: ownerId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 200 },
        endUser: { select: { email: true } },
      },
    }),
  )
  if (row === null) throw notFound("Cette conversation n'existe pas.")
  const first = row.messages.find((m) => m.role === 'visitor')
  return {
    conversation: {
      id: row.id,
      status: row.status === 'escalated' ? 'escalated' : row.status === 'closed' ? 'closed' : 'open',
      category: row.category,
      messageCount: row.messageCount,
      answeredCount: row.answeredCount,
      satisfaction: row.satisfaction,
      preview: (first?.content ?? '').slice(0, 140),
      hasAccount: row.endUserId !== null,
      lastMessageAt: row.lastMessageAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    },
    messages: row.messages.map((m) => ({
      id: m.id,
      role: m.role === 'lia' ? 'lia' : m.role === 'owner' ? 'owner' : 'visitor',
      content: m.content,
      grounded: m.grounded,
      createdAt: m.createdAt.toISOString(),
    })),
    endUserEmail: row.endUser?.email ?? null,
  }
}

export async function deleteConversation(ownerId: string, projectId: string, id: string): Promise<void> {
  const deleted = await withUserScope(ownerId, (tx) =>
    tx.supportConversation.deleteMany({ where: { id, projectId, userId: ownerId } }),
  )
  if (deleted.count === 0) throw notFound("Cette conversation n'existe pas.")
}

export async function closeConversation(ownerId: string, projectId: string, id: string): Promise<void> {
  const updated = await withUserScope(ownerId, (tx) =>
    tx.supportConversation.updateMany({ where: { id, projectId, userId: ownerId }, data: { status: 'closed' } }),
  )
  if (updated.count === 0) throw notFound("Cette conversation n'existe pas.")
}

function toTicket(row: {
  id: string
  conversationId: string | null
  email: string | null
  subject: string
  category: string
  priority: string
  status: string
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date | null
}): TicketView {
  const status = TICKET_STATUSES.find((s) => s === row.status) ?? 'open'
  return {
    id: row.id,
    conversationId: row.conversationId,
    email: row.email,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  }
}

export async function listTickets(ownerId: string, projectId: string): Promise<TicketView[]> {
  const rows = await withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    return tx.supportTicket.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    })
  })
  return rows.map(toTicket)
}

export async function updateTicket(
  ownerId: string,
  projectId: string,
  input: z.infer<typeof ticketUpdate>,
): Promise<TicketView> {
  const { id, ...data } = input
  const row = await withUserScope(ownerId, async (tx) => {
    const found = await tx.supportTicket.findFirst({ where: { id, projectId, userId: ownerId }, select: { id: true, status: true } })
    if (found === null) throw notFound("Ce ticket n'existe pas.")
    const resolvedAt =
      data.status === 'resolved' || data.status === 'closed'
        ? new Date()
        : data.status === undefined
          ? undefined
          : null
    return tx.supportTicket.update({ where: { id }, data: { ...data, resolvedAt } })
  })
  return toTicket(row)
}

/**
 * Réponse du créateur à un ticket. Elle s'ajoute à la conversation, et part par e-mail à
 * l'adresse laissée par le visiteur (ou celle de son compte) quand l'envoi est configuré.
 */
export async function replyToTicket(
  ownerId: string,
  projectId: string,
  input: z.infer<typeof ticketReply>,
): Promise<{ emailed: boolean }> {
  const ticket = await withUserScope(ownerId, (tx) =>
    tx.supportTicket.findFirst({
      where: { id: input.id, projectId, userId: ownerId },
      include: { endUser: { select: { email: true } }, conversation: { select: { id: true } } },
    }),
  )
  if (ticket === null) throw notFound("Ce ticket n'existe pas.")

  if (ticket.conversation !== null) {
    await withUserScope(ownerId, async (tx) => {
      await tx.supportMessage.create({
        data: { projectId, conversationId: ticket.conversation!.id, role: 'owner', content: input.content },
      })
      await tx.supportConversation.update({
        where: { id: ticket.conversation!.id },
        data: { lastMessageAt: new Date() },
      })
      await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: 'in_progress' } })
    })
  }

  const to = ticket.email ?? ticket.endUser?.email ?? null
  if (to === null || !isEmailAvailable()) return { emailed: false }
  const project = await withUserScope(ownerId, (tx) =>
    tx.project.findFirst({ where: { id: projectId, ownerId }, select: { name: true } }),
  )
  await sendEmail({
    to,
    subject: `Réponse à votre demande — ${project?.name ?? 'votre application'}`,
    text: [`Bonjour,`, '', input.content, '', `— L'équipe de ${project?.name ?? "l'application"}`].join('\n'),
  })
  return { emailed: true }
}
