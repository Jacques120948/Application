import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { AppError, notFound, validation } from '@/lib/errors'
import { env } from '@/lib/env'
import { prisma } from '@/server/db/client'
import { withOwnerRuntimeScope, withRuntimeScope } from '@/server/db/scope'
import { answerAsLia } from '@/server/ai/operations'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { isEmailAvailable, sendEmail } from '@/server/email/send'
import { logger } from '@/server/observability/logger'
import { notify } from '@/server/notifications/service'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import { liaQuotaForRuntime } from '@/server/radar/quota'
import { classify, priorityFor } from './classify'
import { retrieve } from './knowledge'
import { readPublicSupportSettings } from './settings'

/**
 * Lia côté visiteur.
 *
 * Tout ce qui est écrit ici est écrit par quelqu'un que la plateforme ne connaît pas et
 * qui ne paie rien : c'est le créateur qui paie. D'où l'ordre des vérifications, le même
 * que pour l'assistant intégré, et pour la même raison — aucun appel réseau tant qu'un
 * garde-fou n'a pas dit oui :
 *
 *   1. Lia est allumée pour cette application (réglage du créateur, drapeau global).
 *   2. La conversation appartient bien à ce visiteur (empreinte ou compte).
 *   3. Le plafond journalier de l'application, compté en base.
 *   4. Le quota mensuel de l'offre du créateur.
 *   5. Le solde de crédits, dans l'opération elle-même.
 *
 * Le visiteur ne voit jamais la cause d'un refus économique : « indisponible », rien de
 * plus. La cause, c'est au créateur qu'elle appartient.
 */

/** Réponses de Lia par application et par jour, toutes conversations confondues. */
export const DAILY_LIA_LIMIT = 300
export const MAX_MESSAGE_LENGTH = 800

export type Actor = { visitorHash: string; endUserId: string | null }

/**
 * Empreinte d'un visiteur anonyme : relie ses messages entre eux sans retenir qui il est.
 * Signée par le secret de session pour qu'une table lue ne redonne ni adresse ni navigateur.
 */
export function visitorHashFor(projectId: string, ip: string | null, userAgent: string | null): string {
  return createHmac('sha256', env.sessionSecret)
    .update(`${projectId}:${ip ?? 'inconnue'}:${(userAgent ?? '').slice(0, 200)}`)
    .digest('hex')
    .slice(0, 40)
}

export const messageInput = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
})

export const ratingInput = z.object({
  conversationId: z.string().uuid(),
  satisfaction: z.union([z.literal(1), z.literal(-1)]),
})

export const ticketInput = z.object({
  conversationId: z.string().uuid().optional(),
  email: z.string().trim().email().max(200).optional(),
  subject: z.string().trim().min(3).max(140).optional(),
  message: z.string().trim().min(3).max(2000),
})

export type MessageView = {
  id: string
  role: 'visitor' | 'lia' | 'owner'
  content: string
  grounded: boolean
  createdAt: string
}

function unavailable(): AppError {
  return new AppError('AI_UNAVAILABLE', "L'assistante est momentanément indisponible. Vous pouvez transmettre votre demande.")
}

async function requireLia(projectId: string) {
  const [runtime, settings] = await Promise.all([resolveRuntimeSpec(projectId), readPublicSupportSettings(projectId)])
  if (settings === null) throw notFound("Cette application n'a pas d'assistante support.")
  return { runtime, settings }
}

/** La conversation, si elle est à ce visiteur. Sinon elle n'existe pas. */
async function requireConversation(projectId: string, conversationId: string, actor: Actor) {
  const conversation = await withRuntimeScope(projectId, (tx) =>
    tx.supportConversation.findFirst({
      where: { id: conversationId, projectId },
      select: { id: true, userId: true, visitorHash: true, endUserId: true, status: true, category: true, messageCount: true },
    }),
  )
  if (conversation === null) throw notFound("Cette conversation n'existe pas.")
  const mine =
    (actor.endUserId !== null && conversation.endUserId === actor.endUserId) ||
    conversation.visitorHash === actor.visitorHash
  if (!mine) throw notFound("Cette conversation n'existe pas.")
  return conversation
}

export async function startConversation(
  projectId: string,
  actor: Actor,
): Promise<{ conversationId: string; displayName: string; greeting: string }> {
  const { runtime, settings } = await requireLia(projectId)
  const quota = await liaQuotaForRuntime(runtime.ownerId, projectId)
  if (quota.conversations.remaining <= 0 || quota.answers.remaining <= 0) throw unavailable()

  const conversation = await withRuntimeScope(projectId, (tx) =>
    tx.supportConversation.create({
      data: { userId: runtime.ownerId, projectId, visitorHash: actor.visitorHash, endUserId: actor.endUserId },
      select: { id: true },
    }),
  )
  return { conversationId: conversation.id, displayName: settings.displayName, greeting: settings.greeting }
}

export async function listMessages(projectId: string, conversationId: string, actor: Actor): Promise<MessageView[]> {
  await requireConversation(projectId, conversationId, actor)
  const rows = await withRuntimeScope(projectId, (tx) =>
    tx.supportMessage.findMany({
      where: { conversationId, projectId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, role: true, content: true, grounded: true, createdAt: true },
    }),
  )
  return rows.map((row) => ({
    id: row.id,
    role: row.role === 'lia' ? 'lia' : row.role === 'owner' ? 'owner' : 'visitor',
    content: row.content,
    grounded: row.grounded,
    createdAt: row.createdAt.toISOString(),
  }))
}

async function countAnswersToday(projectId: string): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  return withRuntimeScope(projectId, (tx) =>
    tx.supportMessage.count({ where: { projectId, role: 'lia', createdAt: { gte: since } } }),
  )
}

async function creatorKeyFor(ownerId: string): Promise<{ id: string; secret: string } | null> {
  const credential = await useCredential(ownerId, 'anthropic', { target: 'APP' })
  return credential === null ? null : { id: credential.connectionId, secret: credential.secret }
}

export async function sendMessage(
  projectId: string,
  input: z.infer<typeof messageInput>,
  actor: Actor,
): Promise<{
  answer: string
  grounded: boolean
  /** Vrai quand Lia n'a pas su répondre : l'écran propose de transmettre. */
  escalationSuggested: boolean
  sources: Array<{ question: string }>
}> {
  const { runtime, settings } = await requireLia(projectId)
  const conversation = await requireConversation(projectId, input.conversationId, actor)
  if (conversation.status === 'closed') throw validation('Cette conversation est terminée.')

  if ((await countAnswersToday(projectId)) >= DAILY_LIA_LIMIT) throw unavailable()
  const quota = await liaQuotaForRuntime(runtime.ownerId, projectId)
  if (quota.answers.remaining <= 0) throw unavailable()

  const [knowledge, history] = await Promise.all([
    retrieve(projectId, input.content),
    withRuntimeScope(projectId, (tx) =>
      tx.supportMessage.findMany({
        where: { conversationId: conversation.id, projectId, role: { in: ['visitor', 'lia'] } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { role: true, content: true },
      }),
    ),
  ])

  const creatorKey = await creatorKeyFor(runtime.ownerId)
  const call = (key: string | null) =>
    answerAsLia({
      ownerId: runtime.ownerId,
      projectId,
      appName: runtime.spec.name,
      displayName: settings.displayName,
      locale: runtime.spec.locale,
      question: input.content,
      history: history.reverse().map((m) => ({ role: m.role === 'lia' ? 'lia' : 'visitor', content: m.content })),
      knowledge: knowledge.map((entry) => ({ question: entry.question, answer: entry.answer })),
      creatorKey: key,
    })

  let result
  try {
    try {
      result = await call(creatorKey?.secret ?? null)
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'CREATOR_KEY_REJECTED')) throw error
      if (creatorKey !== null) await markConnectionError(runtime.ownerId, creatorKey.id, error.message)
      result = await call(null)
    }
  } catch (error) {
    if (error instanceof AppError && (error.code === 'INSUFFICIENT_CREDITS' || error.code === 'PLAN_LIMIT')) {
      throw unavailable()
    }
    throw error
  }

  const used = result.value.usedEntries
    .map((n) => knowledge[n - 1])
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
  const grounded = result.value.canAnswer && used.length > 0

  await withRuntimeScope(projectId, async (tx) => {
    await tx.supportMessage.createMany({
      data: [
        { projectId, conversationId: conversation.id, role: 'visitor', content: input.content },
        {
          projectId,
          conversationId: conversation.id,
          role: 'lia',
          content: result.value.answer,
          grounded,
          sources: used.map((entry) => entry.id),
        },
      ],
    })
    await tx.supportConversation.update({
      where: { id: conversation.id },
      data: {
        messageCount: { increment: 1 },
        answeredCount: grounded ? { increment: 1 } : undefined,
        category: conversation.category ?? result.value.category,
        lastMessageAt: new Date(),
      },
    })
  })

  logger.info('lia : réponse donnée', {
    projectId,
    grounded,
    canAnswer: result.value.canAnswer,
    paidByCreatorKey: result.paidByCreatorKey,
  })

  return {
    answer: result.value.answer,
    grounded,
    escalationSuggested: !result.value.canAnswer,
    sources: used.map((entry) => ({ question: entry.question })),
  }
}

export async function rateConversation(
  projectId: string,
  input: z.infer<typeof ratingInput>,
  actor: Actor,
): Promise<void> {
  const conversation = await requireConversation(projectId, input.conversationId, actor)
  await withRuntimeScope(projectId, (tx) =>
    tx.supportConversation.update({ where: { id: conversation.id }, data: { satisfaction: input.satisfaction } }),
  )
}

/**
 * « Transmettre ma demande ».
 *
 * Le ticket n'a pas de corps : le message vit dans la conversation, créée si besoin. Le
 * créateur est prévenu (notification, et e-mail si configuré) ; le visiteur ne reçoit
 * qu'une confirmation, jamais le contenu d'une autre conversation.
 */
export async function openTicket(
  projectId: string,
  input: z.infer<typeof ticketInput>,
  actor: Actor,
): Promise<{ ticketId: string }> {
  const { runtime } = await requireLia(projectId)
  const category = classify(`${input.subject ?? ''} ${input.message}`)
  const subject = input.subject ?? input.message.slice(0, 120)

  let conversationId: string
  if (input.conversationId !== undefined) {
    conversationId = (await requireConversation(projectId, input.conversationId, actor)).id
  } else {
    const quota = await liaQuotaForRuntime(runtime.ownerId, projectId)
    if (quota.conversations.remaining <= 0) throw unavailable()
    conversationId = (
      await withRuntimeScope(projectId, (tx) =>
        tx.supportConversation.create({
          data: { userId: runtime.ownerId, projectId, visitorHash: actor.visitorHash, endUserId: actor.endUserId, category },
          select: { id: true },
        }),
      )
    ).id
  }

  // Le visiteur peut créer un ticket, jamais en relire un : la portée d'exécution seule ne
  // permet donc pas de récupérer la ligne créée. Le serveur, lui, connaît le créateur, et
  // c'est sous cette portée combinée que le ticket est écrit — au nom du visiteur, pour le
  // créateur.
  const ticket = await withOwnerRuntimeScope(runtime.ownerId, projectId, async (tx) => {
    await tx.supportMessage.create({
      data: { projectId, conversationId, role: 'visitor', content: input.message },
    })
    await tx.supportConversation.update({
      where: { id: conversationId },
      data: { status: 'escalated', messageCount: { increment: 1 }, lastMessageAt: new Date() },
    })
    return tx.supportTicket.create({
      data: {
        userId: runtime.ownerId,
        projectId,
        conversationId,
        endUserId: actor.endUserId,
        email: input.email ?? null,
        subject,
        category,
        priority: priorityFor(category),
      },
      select: { id: true },
    })
  })

  await notify(runtime.ownerId, {
    kind: 'support_ticket',
    title: `Nouvelle demande dans « ${runtime.spec.name} »`,
    body: subject,
    href: `/${runtime.spec.locale}/projets/${projectId}?onglet=support`,
  })

  if (isEmailAvailable()) {
    const [settings, owner] = await Promise.all([
      withRuntimeScope(projectId, (tx) =>
        tx.supportSettings.findUnique({ where: { projectId }, select: { escalationEmail: true } }),
      ),
      prisma.user.findUnique({ where: { id: runtime.ownerId }, select: { email: true, supportAlerts: true } }),
    ])
    const to = settings?.escalationEmail ?? (owner?.supportAlerts ? owner.email : null)
    if (to !== null && to !== undefined) {
      await sendEmail({
        to,
        subject: `Evoliia — nouvelle demande dans « ${runtime.spec.name} »`,
        text: [
          `Un utilisateur de « ${runtime.spec.name} » a transmis une demande que l'assistante n'a pas pu traiter.`,
          '',
          `Sujet : ${subject}`,
          `Catégorie : ${category}`,
          '',
          `La lire : ${env.appUrl.replace(/\/$/, '')}/${runtime.spec.locale}/projets/${projectId}?onglet=support`,
        ].join('\n'),
      }).catch(() => undefined)
    }
  }

  logger.info('lia : ticket ouvert', { projectId, ticketId: ticket.id, category })
  return { ticketId: ticket.id }
}
