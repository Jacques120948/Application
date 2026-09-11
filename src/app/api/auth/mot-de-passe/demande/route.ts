import { requestPasswordReset, resetRequestInput } from '@/server/auth/password-reset'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const { email } = resetRequestInput.parse(await readJson(request))
    await requestPasswordReset(email, { ip: clientIp(request) })
    // Réponse volontairement identique, que le compte existe ou non.
    return ok({ sent: true })
  } catch (error) {
    return fail(error)
  }
}
