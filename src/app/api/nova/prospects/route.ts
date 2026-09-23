import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { enregistrerProspects, prospectsSchema } from '@/server/nova/reglages'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les événements clés de GA4 que la personne compte comme prospects. `null` rend la main à
 * Nova, qui les reconnaît à leur nom. Aucun crédit : c'est un réglage.
 */
const input = z.object({ evenements: prospectsSchema })

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'nova_agent')
    consume(`nova-reglages:${user.id}`, RULES.aiOperation)
    const { evenements } = input.parse(await readJson(request))
    await enregistrerProspects(user.id, evenements)
    return ok({ evenements })
  } catch (error) {
    return fail(error)
  }
}
