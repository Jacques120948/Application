import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { choisirPropriete, proprietesDisponibles, synchroniserVisites } from '@/server/nova/collecte-ga4'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Choisir la propriété Google Analytics que Nova suit.
 *
 * La propriété doit figurer parmi celles que le compte Google relié peut lire : un
 * identifiant tapé à la main n'ouvre rien. Les jours de l'ancienne propriété sont effacés,
 * puis la nouvelle est lue en entier.
 */
export const maxDuration = 60

const input = z.object({ propriete: z.string().regex(/^properties\/\d+$/u) })

/** Les propriétés que le compte Google relié peut lire. Demandé au clic, jamais à l'ouverture. */
export async function GET() {
  try {
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'nova_agent')
    consume(`nova-ga4:${user.id}`, RULES.aiOperation)
    return ok({ proprietes: await proprietesDisponibles(user.id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'nova_agent')
    consume(`nova-ga4:${user.id}`, RULES.aiOperation)
    const { propriete } = input.parse(await readJson(request))
    await choisirPropriete(user.id, propriete)
    const etat = await synchroniserVisites(user.id, 'manuel')
    return ok({ etat: etat.etat, message: etat.message })
  } catch (error) {
    return fail(error)
  }
}
