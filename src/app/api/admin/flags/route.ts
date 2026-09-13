import { flagInput, updateFlag } from '@/server/admin/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Allume ou éteint une fonction pour toute l'installation. Réservé à l'administration. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const input = flagInput.parse(await readJson(request))
    await updateFlag(input)
    return ok({ saved: true })
  } catch (error) {
    return fail(error)
  }
}
