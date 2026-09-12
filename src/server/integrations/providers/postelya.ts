import { createHmac } from 'node:crypto'
import { logger } from '@/server/observability/logger'
import type { KeyVerifier } from '../verify'

/**
 * Liaison d'un espace Postelya.
 *
 * Le créateur ne colle pas une clé mais un code d'appairage, lu dans son propre espace
 * Postelya. Evoliia l'échange contre une autorisation durable, et c'est elle qui est
 * conservée : le code, lui, est périmé dès qu'il a servi.
 *
 * Deux preuves circulent, et elles ne disent pas la même chose. La signature prouve que la
 * demande vient d'Evoliia ; le code prouve qu'une personne ayant la main sur l'espace a
 * voulu cette liaison. Sans code, Evoliia pourrait se relier à l'espace de n'importe qui.
 */

const SIGNATURE_VERSION = 'v1'

function sign(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret)
    .update(`${SIGNATURE_VERSION}.${timestamp}.${body}`)
    .digest('hex')
  return `${SIGNATURE_VERSION}=${mac}`
}

export const verifyPostelyaCode: KeyVerifier = async (code) => {
  const url = process.env.SOCIAL_ENGINE_URL
  const secret = process.env.SOCIAL_ENGINE_SECRET
  if (!url || !secret || secret.length < 32) {
    return { ok: false, reason: "Le module social n'est pas activé sur cette installation." }
  }

  const body = JSON.stringify({
    version: '1',
    service: 'evoliia',
    code: code.toUpperCase().replace(/[^A-Z0-9]/g, ''),
  })
  const timestamp = String(Math.floor(Date.now() / 1000))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  let response: Response
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/api/engine/link`, {
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
    return { ok: false, reason: 'Postelya est momentanément injoignable. Réessayez.' }
  } finally {
    clearTimeout(timer)
  }

  const payload = (await response.json().catch(() => null)) as {
    error?: string
    grant?: string
    workspace?: { id: string; name: string }
  } | null

  if (!response.ok || payload?.grant === undefined || payload.workspace === undefined) {
    // Le code ne figure jamais dans le journal : il est court, et un journal se relit.
    logger.warn('liaison Postelya refusée', { status: response.status })
    return {
      ok: false,
      reason: payload?.error ?? "Ce code n'est pas valide ou a expiré.",
    }
  }

  return {
    ok: true,
    label: `Espace Postelya · ${payload.workspace.name}`,
    secret: payload.grant,
  }
}
