import { legalIdentityInput, updateLegalIdentity } from '@/server/admin/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const input = legalIdentityInput.parse(await readJson(request))
    await updateLegalIdentity(input)
    return ok({ saved: true })
  } catch (error) {
    return fail(error)
  }
}
