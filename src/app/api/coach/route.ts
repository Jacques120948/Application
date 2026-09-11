import { coachInput, helpCreator } from '@/server/business/coach'
import { requireUser } from '@/server/auth/session'
import { resolveLocale } from '@/i18n'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = coachInput.parse(await readJson(request))
    const locale = resolveLocale(user.locale)
    return ok(await helpCreator(user.id, input, locale))
  } catch (error) {
    return fail(error)
  }
}
