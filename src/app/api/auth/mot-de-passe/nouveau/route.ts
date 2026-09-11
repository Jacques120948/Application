import { confirmPasswordReset, resetConfirmInput } from '@/server/auth/password-reset'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const { token, password } = resetConfirmInput.parse(await readJson(request))
    await confirmPasswordReset(token, password, { ip: clientIp(request) })
    return ok({ done: true })
  } catch (error) {
    return fail(error)
  }
}
