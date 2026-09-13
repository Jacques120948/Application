import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { readRadarAlerts, setRadarAlerts } from '@/server/radar/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const input = z.object({ enabled: z.boolean() })

/** Choix de la personne : recevoir ou non la recherche mensuelle automatique (V2). */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    await setRadarAlerts(user.id, body.enabled)
    return ok({ enabled: await readRadarAlerts(user.id) })
  } catch (error) {
    return fail(error)
  }
}
