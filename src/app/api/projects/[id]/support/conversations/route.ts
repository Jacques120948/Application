import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import {
  closeConversation,
  CONVERSATION_STATUSES,
  deleteConversation,
  getConversation,
  listConversations,
} from '@/server/support/owner'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    const params = new URL(request.url).searchParams
    const conversationId = params.get('id')
    if (conversationId !== null) return ok(await getConversation(user.id, id, conversationId))
    const status = CONVERSATION_STATUSES.find((s) => s === params.get('statut'))
    return ok({ conversations: await listConversations(user.id, id, { status }) })
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = z.object({ id: z.string().uuid(), action: z.literal('close') }).parse(await readJson(request))
    await closeConversation(user.id, id, body.id)
    return ok({ closed: true })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = z.object({ id: z.string().uuid() }).parse(await readJson(request))
    await deleteConversation(user.id, id, body.id)
    return ok({ deleted: true })
  } catch (error) {
    return fail(error)
  }
}
