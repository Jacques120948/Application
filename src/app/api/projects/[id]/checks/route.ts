import { requireUser } from '@/server/auth/session'
import { runProjectChecks } from '@/server/projects/service'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/** Exigence 16 : « Tester mon application ». Déterministe, sans crédit consommé. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    return ok(await runProjectChecks(user.id, id))
  } catch (error) {
    return fail(error)
  }
}
