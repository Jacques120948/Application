import { requireUser } from '@/server/auth/session'
import { restoreVersion } from '@/server/projects/service'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id, versionId } = await context.params
    return ok(await restoreVersion(user.id, id, versionId))
  } catch (error) {
    return fail(error)
  }
}
