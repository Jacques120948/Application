import { requireUser } from '@/server/auth/session'
import { getSupportOverview } from '@/server/support/owner'
import { settingsInput, updateSupportSettings } from '@/server/support/settings'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

type Context = { params: Promise<{ id: string }> }

/** Le tableau de bord support d'une application : chiffres, réglages, quota. */
export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok(await getSupportOverview(user.id, id))
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const input = settingsInput.parse(await readJson(request))
    return ok({ settings: await updateSupportSettings(user.id, id, input) })
  } catch (error) {
    return fail(error)
  }
}
