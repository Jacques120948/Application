import { consume, RULES } from '@/server/auth/rate-limit'
import { startConversation } from '@/server/support/conversation'
import { assertSameOrigin, clientIp, fail, ok } from '@/server/http/respond'
import { actorFor } from './actor'

type Context = { params: Promise<{ projectId: string }> }

/** Ouvre une conversation avec Lia. Compte dans le quota de conversations du créateur. */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`lia:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.liaMessage)
    return ok(await startConversation(projectId, await actorFor(request, projectId)))
  } catch (error) {
    return fail(error)
  }
}
