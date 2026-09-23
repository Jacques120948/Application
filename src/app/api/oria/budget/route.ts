import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { budgetsInput, enregistrerBudgets } from '@/server/oria/budget'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les budgets marketing déclarés. Rien d'autre : aucune route d'Oria ne modifie un budget
 * publicitaire — cela se fait chez Naya ou chez MIRA, après confirmation.
 */
const input = z.object({ siteId: z.string().uuid(), budgets: budgetsInput })

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`oria-budget:${user.id}`, RULES.aiOperation)
    const { siteId, budgets } = input.parse(await readJson(request))
    return ok({ budgets: await enregistrerBudgets(user.id, siteId, budgets) })
  } catch (error) {
    return fail(error)
  }
}
