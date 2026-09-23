import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { synchroniserLina } from '@/server/lina/collecte'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Faire avancer la lecture de la base clients.
 *
 * `auto` à l'ouverture (seulement si l'index a plus de douze heures), `manuel` sur « Analyser
 * mes clients », `suivre` pendant que Shopify prépare l'export — l'écran le demande toutes
 * les quelques secondes, sans rien relancer. Aucun crédit : c'est une lecture.
 */
export const maxDuration = 60

const input = z.object({ mode: z.enum(['auto', 'manuel', 'suivre']).default('auto') })

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-synchro:${user.id}`, RULES.aiOperation)
    const { mode } = input.parse(await readJson(request))
    const etat = await synchroniserLina(user.id, mode)
    return ok({
      etat: etat.etat,
      message: etat.message,
      clients: etat.clients,
      synchroAt: etat.synchroAt?.toISOString() ?? null,
    })
  } catch (error) {
    return fail(error)
  }
}
