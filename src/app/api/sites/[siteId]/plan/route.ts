import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { ETATS_ACTION, readPlan, setActionState } from '@/server/audit/plan'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * L'état d'une ligne du plan d'action.
 *
 * Cocher « corrigée » n'est ni une opération coûteuse ni un appel à l'IA : c'est une case,
 * et le débit accordé le reflète. Le site, lui, est vérifié côté serveur à chaque appel —
 * un identifiant venu du navigateur n'ouvre rien qu'on ne possède déjà.
 */
const input = z.object({
  checkId: z.string().min(1).max(120),
  state: z.enum(ETATS_ACTION),
  note: z.string().max(500).optional(),
})

export async function GET(_request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    const user = await requireUser()
    const { siteId } = await context.params
    return ok({ plan: await readPlan(user.id, siteId) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`plan:${user.id}`, RULES.appWrite)
    const { siteId } = await context.params
    const body = input.parse(await readJson(request))

    await setActionState(user.id, siteId, body.checkId, body.state, body.note)
    return ok({ checkId: body.checkId, state: body.state })
  } catch (error) {
    return fail(error)
  }
}
