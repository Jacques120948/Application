import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { reglerBilanEmail } from '@/server/lina/bilan-email'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const schema = z.object({ actif: z.boolean() }).strict()

/** Recevoir ou non le bilan de Lina par e-mail, le lundi. Éteint par défaut. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-reglages:${user.id}`, RULES.appWrite)
    return ok({ actif: await reglerBilanEmail(user.id, schema.parse(await readJson(request)).actif) })
  } catch (error) {
    return fail(error)
  }
}
