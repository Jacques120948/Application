import { consume, RULES } from '@/server/auth/rate-limit'
import { listMessages, messageInput, sendMessage } from '@/server/support/conversation'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'
import { actorFor } from '../actor'

type Context = { params: Promise<{ projectId: string }> }

export const maxDuration = 60

export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params
    const conversationId = new URL(request.url).searchParams.get('conversation') ?? ''
    return ok({ messages: await listMessages(projectId, conversationId, await actorFor(request, projectId)) })
  } catch (error) {
    return fail(error)
  }
}

/** Un message du visiteur, une réponse de Lia. Le créateur paie : d'où la limite par visiteur. */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`lia:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.liaMessage)
    const input = messageInput.parse(await readJson(request))
    return ok(await sendMessage(projectId, input, await actorFor(request, projectId)))
  } catch (error) {
    return fail(error)
  }
}
