import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { criteresSchema, enregistrerCriteres } from '@/server/lina/criteres'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Les seuils des segments de Lina. Validés ici : un client « dormant » avant d'être inactif n'a pas de sens. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-reglages:${user.id}`, RULES.aiOperation)
    const criteres = await enregistrerCriteres(user.id, criteresSchema.parse(await readJson(request)))
    return ok({ criteres })
  } catch (error) {
    return fail(error)
  }
}
