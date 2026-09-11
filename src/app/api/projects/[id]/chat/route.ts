import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { editWithAssistant, listChatMessages } from '@/server/projects/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const input = z.object({ message: z.string().min(1).max(2000) })

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ messages: await listChatMessages(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = input.parse(await readJson(request))
    return ok(await editWithAssistant(user.id, id, body.message))
  } catch (error) {
    return fail(error)
  }
}
