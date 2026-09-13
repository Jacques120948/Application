import { rateConversation, ratingInput } from '@/server/support/conversation'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { actorFor } from '../actor'

type Context = { params: Promise<{ projectId: string }> }

/** « Utile » / « Pas utile ». Une valeur par conversation, remplaçable. */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    const input = ratingInput.parse(await readJson(request))
    await rateConversation(projectId, input, await actorFor(request, projectId))
    return ok({ saved: true })
  } catch (error) {
    return fail(error)
  }
}
