import { requireUser } from '@/server/auth/session'
import { discardIdea } from '@/server/business/ideas'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    await discardIdea(user.id, id)
    return ok({ done: true })
  } catch (error) {
    return fail(error)
  }
}
