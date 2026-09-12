import { createHmac } from 'node:crypto'
import { AppError, notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { useCredential } from '@/server/integrations/service'
import { launchKitSchema, type ScheduledPost } from '@/lib/marketing'

/**
 * Dépôt d'une semaine dans l'espace social du créateur.
 *
 * Evoliia dépose, elle ne publie pas. Ce qui part d'ici arrive en brouillon dans Postelya,
 * où le créateur relit, corrige et programme. Aucun réseau social n'est touché par cette
 * opération, et c'est ce qui permet de la déclencher d'un bouton sans prendre de risque
 * pour la réputation de qui que ce soit.
 *
 * L'envoi est rejouable sans dommage : chaque publication porte une référence tirée du kit
 * et de son rang, et Postelya refuse d'en créer une seconde sous la même référence. Un
 * créateur qui reclique après une coupure réseau ne se retrouve pas avec quatorze
 * brouillons.
 */

const SIGNATURE_VERSION = 'v1'
const TIMEOUT_MS = 30_000

function sign(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret)
    .update(`${SIGNATURE_VERSION}.${timestamp}.${body}`)
    .digest('hex')
  return `${SIGNATURE_VERSION}=${mac}`
}

/**
 * Date proposée pour une publication de la semaine.
 *
 * Le kit dit « lundi à 18:30 », pas une date. On la pose sur la semaine qui vient, à partir
 * du lundi suivant : proposer des dates déjà passées obligerait le créateur à toutes les
 * refaire avant de programmer quoi que ce soit.
 */
export function nextOccurrence(post: ScheduledPost, from: Date): Date | null {
  const parts = post.time.split(':')
  const hours = Number.parseInt(parts[0] ?? '', 10)
  const minutes = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  // Lundi de la semaine prochaine, à minuit.
  const monday = new Date(from)
  monday.setHours(0, 0, 0, 0)
  const weekday = (monday.getDay() + 6) % 7 // 0 = lundi
  monday.setDate(monday.getDate() + (7 - weekday))

  const when = new Date(monday)
  when.setDate(monday.getDate() + post.day)
  when.setHours(hours, minutes, 0, 0)
  return when
}

export type SendResult = { created: number; alreadyThere: number; workspace: string }

export async function sendWeekToSocial(userId: string, kitId: string): Promise<SendResult> {
  const url = process.env.SOCIAL_ENGINE_URL
  const secret = process.env.SOCIAL_ENGINE_SECRET
  if (!url || !secret || secret.length < 32) {
    throw new AppError('AI_UNAVAILABLE', "Le module social n'est pas activé sur cette installation.")
  }

  const kit = await withUserScope(userId, (tx) =>
    tx.marketingKit.findFirst({
      where: { id: kitId, userId },
      select: { id: true, content: true, approvedAt: true },
    }),
  )
  if (kit === null) throw notFound("Ce kit n'existe pas.")

  /*
   * Seul un kit approuvé part. Ce n'est pas une formalité : approuver est le geste par
   * lequel le créateur dit avoir tout relu. Déposer sans lui reviendrait à mettre dans son
   * espace des textes qu'il n'a peut-être jamais lus.
   */
  if (kit.approvedAt === null) {
    throw validation('Approuvez d’abord votre semaine : vous n’envoyez que ce que vous avez relu.')
  }

  const parsed = launchKitSchema.safeParse(kit.content)
  if (!parsed.success) throw validation("Ce kit n'est plus lisible. Regénérez-le.")

  const credential = await useCredential(userId, 'postelya', { target: 'EVOLIIA' })
  if (credential === null) {
    throw new AppError(
      'PLAN_LIMIT',
      "Reliez d’abord votre espace Postelya, depuis l’écran Connexions.",
    )
  }

  const now = new Date()
  const body = JSON.stringify({
    version: '1',
    service: 'evoliia',
    grant: credential.secret,
    batchRef: kit.id,
    posts: parsed.data.week.map((post, index) => ({
      index,
      caption: post.caption,
      hashtags: post.hashtags,
      cta: post.cta,
      format: post.format,
      angle: post.angleKey,
      objective: post.objective,
      suggestedAt: nextOccurrence(post, now)?.toISOString() ?? null,
    })),
  })

  const timestamp = String(Math.floor(now.getTime() / 1000))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/api/engine/drafts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-engine-timestamp': timestamp,
        'x-engine-signature': sign(secret, timestamp, body),
      },
      body,
      signal: controller.signal,
    })
  } catch {
    throw new AppError(
      'AI_UNAVAILABLE',
      'Postelya est momentanément injoignable. Réessayez, rien ne sera envoyé en double.',
    )
  } finally {
    clearTimeout(timer)
  }

  const payload = (await response.json().catch(() => null)) as {
    error?: string
    code?: string
    created?: number
    alreadyThere?: number
    workspace?: { name: string }
  } | null

  if (!response.ok) {
    logger.warn('dépôt social refusé', { userId, status: response.status, code: payload?.code })
    if (payload?.code === 'LINK_REVOKED') {
      throw new AppError(
        'PLAN_LIMIT',
        "Votre espace Postelya n'est plus relié. Refaites la liaison depuis l’écran Connexions.",
      )
    }
    throw new AppError('AI_UNAVAILABLE', payload?.error ?? "Le dépôt n'a pas abouti.")
  }

  await withUserScope(userId, (tx) =>
    tx.marketingKit.updateMany({ where: { id: kit.id, userId }, data: { sentToSocialAt: now } }),
  )

  logger.info('semaine déposée', { userId, kitId: kit.id, created: payload?.created ?? 0 })

  return {
    created: payload?.created ?? 0,
    alreadyThere: payload?.alreadyThere ?? 0,
    workspace: payload?.workspace?.name ?? 'votre espace',
  }
}
