import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { synchroniserVentes } from '@/server/nova/collecte'
import { synchroniserVisites } from '@/server/nova/collecte-ga4'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Relire les ventes de la boutique et les visites de Google Analytics.
 *
 * `auto` : appelé par l'écran de Nova à l'ouverture ; ne relit que si les données ont plus
 * de douze heures. `manuel` : le bouton « Actualiser », qui relit toute la fenêtre. Aucun
 * crédit : c'est une lecture, pas un appel à un modèle.
 */
export const maxDuration = 60

const input = z.object({ mode: z.enum(['auto', 'manuel']).default('auto') })

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'nova_agent')
    consume(`nova-synchro:${user.id}`, RULES.aiOperation)
    const { mode } = input.parse(await readJson(request))
    // Les deux sources se relisent ensemble ; une panne de l'une n'empêche pas l'autre.
    const [etat, visites] = await Promise.all([synchroniserVentes(user.id, mode), synchroniserVisites(user.id, mode)])
    const probleme = [etat, visites].find((un) => un.etat === 'erreur' || un.etat === 'portee')
    return ok({
      etat: probleme === undefined ? 'ok' : probleme.etat,
      message: probleme?.message ?? '',
      synchroAt: etat.synchroAt?.toISOString() ?? visites.synchroAt?.toISOString() ?? null,
    })
  } catch (error) {
    return fail(error)
  }
}
