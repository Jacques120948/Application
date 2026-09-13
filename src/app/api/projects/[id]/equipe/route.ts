import { requireUser } from '@/server/auth/session'
import { resolveLocale } from '@/i18n'
import { ask, askInput } from '@/server/agents/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 40

/**
 * Question posée à l'un des trois spécialistes marketing.
 *
 * Le projet vient de l'adresse, pas du corps de la requête : deux sources pour la même
 * information, c'est une occasion de les voir diverger. Le service revérifie de toute façon
 * que le projet appartient bien à la personne connectée.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await params
    const body = (await readJson(request)) as Record<string, unknown>
    const input = askInput.parse({ ...body, projectId: id })
    return ok(await ask(user.id, input, resolveLocale(user.locale)))
  } catch (error) {
    return fail(error)
  }
}
