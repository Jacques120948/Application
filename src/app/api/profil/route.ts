import { requireUser } from '@/server/auth/session'
import { getProfile, profileInput, saveProfile } from '@/server/business/profile'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Objectif et profil du créateur : le point de départ du parcours. */

export async function GET() {
  try {
    const user = await requireUser()
    return ok({ profile: await getProfile(user.id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = profileInput.parse(await readJson(request))
    return ok({ profile: await saveProfile(user.id, input) })
  } catch (error) {
    return fail(error)
  }
}
