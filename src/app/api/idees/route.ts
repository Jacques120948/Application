import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { listIdeas, proposeIdeas } from '@/server/business/ideas'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

const input = z.object({ locale: z.enum(SUPPORTED_LOCALES).default('fr') })

export async function GET() {
  try {
    const user = await requireUser()
    return ok({ ideas: await listIdeas(user.id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    return ok(await proposeIdeas(user.id, body.locale))
  } catch (error) {
    return fail(error)
  }
}
