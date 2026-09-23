import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { creerSegmentAssiste, executionSchema } from '@/server/lina/assiste'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Le mode assisté : la personne a validé, Lina crée le segment dans Shopify. La requête est
 * recalculée par le serveur ; le navigateur ne dit que lequel. Aucun crédit.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-executer:${user.id}`, RULES.appWrite)
    return ok(await creerSegmentAssiste(user.id, executionSchema.parse(await readJson(request))))
  } catch (error) {
    return fail(error)
  }
}
