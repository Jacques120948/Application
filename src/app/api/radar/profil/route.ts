import { requireUser } from '@/server/auth/session'
import { improveProfile, missingPrecisions, radarProfileInput } from '@/server/radar/profile'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Les précisions facultatives du profil. Ne touche à rien d'autre. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = radarProfileInput.parse(await readJson(request))
    const profile = await improveProfile(user.id, body)
    return ok({ missingPrecisions: missingPrecisions(profile) })
  } catch (error) {
    return fail(error)
  }
}
