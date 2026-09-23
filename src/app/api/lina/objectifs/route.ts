import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { enregistrerObjectifs, objectifsLinaSchema } from '@/server/lina/objectifs'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Les objectifs CRM que la personne se fixe. Aucun crédit. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-reglages:${user.id}`, RULES.appWrite)
    const objectifs = await enregistrerObjectifs(user.id, objectifsLinaSchema.parse(await readJson(request)))
    return ok({ objectifs })
  } catch (error) {
    return fail(error)
  }
}
