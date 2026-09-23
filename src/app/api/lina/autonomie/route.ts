import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { enregistrerAutonomie, NIVEAUX_AUTONOMIE } from '@/server/lina/assiste'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const schema = z.object({ niveau: z.enum(NIVEAUX_AUTONOMIE) }).strict()

/** Conseil ou Assisté. Aucun niveau « automatique » : rien ne s'exécute sans validation. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-reglages:${user.id}`, RULES.appWrite)
    return ok({ niveau: await enregistrerAutonomie(user.id, schema.parse(await readJson(request)).niveau) })
  } catch (error) {
    return fail(error)
  }
}
