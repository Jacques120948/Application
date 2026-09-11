import { env } from '@/lib/env'
import { requireUser } from '@/server/auth/session'
import { publishProject } from '@/server/projects/service'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    return ok(await publishProject(user.id, id, env.appUrl))
  } catch (error) {
    return fail(error)
  }
}
