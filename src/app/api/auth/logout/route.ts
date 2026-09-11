import { clearSessionCookie, revokeCurrentSession } from '@/server/auth/session'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await revokeCurrentSession()
    await clearSessionCookie()
    return ok({ done: true })
  } catch (error) {
    return fail(error)
  }
}
