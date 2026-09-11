import { requireUser } from '@/server/auth/session'
import { listVersions } from '@/server/projects/service'
import { fail, ok } from '@/server/http/respond'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ versions: await listVersions(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}
