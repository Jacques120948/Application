import { requireUser } from '@/server/auth/session'
import { listTickets, replyToTicket, ticketReply, ticketUpdate, updateTicket } from '@/server/support/owner'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ tickets: await listTickets(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const input = ticketUpdate.parse(await readJson(request))
    return ok({ ticket: await updateTicket(user.id, id, input) })
  } catch (error) {
    return fail(error)
  }
}

/** Répondre au visiteur. Part par e-mail quand une adresse existe et que l'envoi est configuré. */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const input = ticketReply.parse(await readJson(request))
    return ok(await replyToTicket(user.id, id, input))
  } catch (error) {
    return fail(error)
  }
}
