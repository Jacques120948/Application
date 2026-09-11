import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { createProjectFromIdea } from '@/server/projects/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

const input = z.object({ locale: z.enum(SUPPORTED_LOCALES).default('fr') })

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = input.parse(await readJson(request))
    return ok(await createProjectFromIdea(user.id, id, body.locale), 201)
  } catch (error) {
    return fail(error)
  }
}
