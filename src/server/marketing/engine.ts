import { createHmac } from 'node:crypto'
import { AppError } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import type { BrandContext, LaunchKit } from '@/lib/marketing'

/**
 * Client du moteur social.
 *
 * Postelya reste un produit à part entière ; Evoliia en consomme le moteur par un seul
 * point d'entrée, signé. Rien de Postelya n'est recopié ici : ni ses prompts, ni sa base,
 * ni ses écrans. Ce fichier sait deux choses — comment signer une demande, et comment se
 * comporter quand le moteur ne répond pas.
 *
 * Le défaut assumé : si le moteur est indisponible, Evoliia continue de fonctionner. Le
 * créateur perd la préparation de son lancement pour quelques minutes, pas son projet.
 */

const TIMEOUT_MS = 120_000
const SIGNATURE_VERSION = 'v1'

export type EngineCaller = {
  userRef: string
  projectRef: string
  plan: string
  action: string
}

export type EngineUsage = {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  model: string
}

export type LaunchKitResult = { kit: LaunchKit; usage: EngineUsage; engineVersion: string }

export function isEngineAvailable(): boolean {
  const url = process.env.SOCIAL_ENGINE_URL
  const secret = process.env.SOCIAL_ENGINE_SECRET
  return (
    typeof url === 'string' &&
    url.length > 0 &&
    typeof secret === 'string' &&
    secret.length >= 32
  )
}

function sign(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret)
    .update(`${SIGNATURE_VERSION}.${timestamp}.${body}`)
    .digest('hex')
  return `${SIGNATURE_VERSION}=${mac}`
}

const unavailable = () =>
  new AppError(
    'AI_UNAVAILABLE',
    'Le module marketing est momentanément indisponible. Votre projet reste accessible.',
  )

/**
 * Demande un kit de lancement.
 *
 * Un seul réessai, et seulement sur une panne de transport : un moteur qui a répondu « ta
 * demande est invalide » répondra la même chose la seconde fois, et un appel qui a peut-être
 * abouti ne doit pas être relancé — il aurait été payé deux fois.
 */
export async function requestLaunchKit(params: {
  caller: EngineCaller
  brand: BrandContext
  options?: { angleCount?: number; ideaCount?: number; postsPerWeek?: number }
}): Promise<LaunchKitResult> {
  const url = process.env.SOCIAL_ENGINE_URL
  const secret = process.env.SOCIAL_ENGINE_SECRET
  if (!url || !secret || secret.length < 32) throw unavailable()

  const body = JSON.stringify({
    version: '1',
    caller: { service: 'evoliia', ...params.caller },
    brand: params.brand,
    options: {
      angleCount: params.options?.angleCount ?? 3,
      ideaCount: params.options?.ideaCount ?? 7,
      postsPerWeek: params.options?.postsPerWeek ?? 7,
    },
  })

  const attempt = async (): Promise<Response> => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      return await fetch(`${url.replace(/\/$/, '')}/api/engine/launch-kit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-engine-timestamp': timestamp,
          'x-engine-signature': sign(secret, timestamp, body),
        },
        body,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let response: Response
  try {
    response = await attempt()
  } catch (first) {
    logger.warn('moteur social injoignable, seconde tentative', {
      projectRef: params.caller.projectRef,
      reason: first instanceof Error ? first.message : 'inconnu',
    })
    try {
      response = await attempt()
    } catch {
      throw unavailable()
    }
  }

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    logger.error('moteur social en erreur', {
      projectRef: params.caller.projectRef,
      status: response.status,
    })
    // 4xx : la demande est en cause et le redire n'y changera rien. 5xx : indisponibilité.
    throw response.status >= 400 && response.status < 500 && response.status !== 429
      ? new AppError('UNSUPPORTED_REQUEST', detail?.error ?? "Le moteur a refusé cette demande.")
      : unavailable()
  }

  const payload = (await response.json().catch(() => null)) as {
    version?: string
    kit?: LaunchKit
    usage?: EngineUsage
  } | null

  if (payload?.kit == null || payload.usage == null) throw unavailable()

  return {
    kit: payload.kit,
    usage: payload.usage,
    engineVersion: payload.version ?? '1',
  }
}
