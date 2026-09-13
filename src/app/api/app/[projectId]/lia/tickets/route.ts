import { consume, RULES } from '@/server/auth/rate-limit'
import { openTicket, ticketInput } from '@/server/support/conversation'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'
import { actorFor } from '../actor'

type Context = { params: Promise<{ projectId: string }> }

/** « Transmettre ma demande ». Quelques-unes par heure suffisent à une personne de bonne foi. */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`lia-ticket:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.liaTicket)
    const input = ticketInput.parse(await readJson(request))
    return ok(await openTicket(projectId, input, await actorFor(request, projectId)))
  } catch (error) {
    return fail(error)
  }
}
