import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { compare, compareInput } from '@/server/radar/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

export const maxDuration = 60

const input = compareInput.extend({ locale: z.enum(SUPPORTED_LOCALES).default('fr') })

/** Comparer deux ou trois opportunités. Le tableau est calculé, seule la synthèse est payante. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    return ok(await compare(user.id, { ideaIds: body.ideaIds }, body.locale))
  } catch (error) {
    return fail(error)
  }
}
