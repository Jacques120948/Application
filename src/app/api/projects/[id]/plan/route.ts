import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { decidePlan } from '@/server/projects/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Décision du créateur sur une modification annoncée.
 *
 * Aucun appel au modèle ici, et donc aucun crédit : le travail a été payé quand il a été
 * fait. Cliquer « Appliquer » ne fait que poser sur le projet ce qui attendait déjà.
 */
const input = z.object({
  messageId: z.string().uuid(),
  action: z.enum(['apply', 'cancel']),
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = input.parse(await readJson(request))
    return ok(await decidePlan(user.id, id, body.messageId, body.action))
  } catch (error) {
    return fail(error)
  }
}
