import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { runValidation } from '@/server/business/ideas'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

const input = z.object({ locale: z.enum(SUPPORTED_LOCALES).default('fr') })

/** Analyse approfondie avant de construire quoi que ce soit. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = input.parse(await readJson(request))
    return ok(await runValidation(user.id, id, body.locale))
  } catch (error) {
    return fail(error)
  }
}
