import { loginInput, login } from '@/server/auth/service'
import { setSessionCookie } from '@/server/auth/session'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const input = loginInput.parse(await readJson(request))
    const session = await login(input, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    await setSessionCookie(session.token, session.expiresAt)
    return ok({ userId: session.userId })
  } catch (error) {
    return fail(error)
  }
}
