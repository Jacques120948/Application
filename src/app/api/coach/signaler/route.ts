import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { reportProblem } from '@/server/support/creator'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Un créateur signale ce que l'assistant n'a pas pu résoudre.
 *
 * Le corps ne porte que ce que le créateur a écrit et le nom de l'écran. Tout le reste — son
 * offre, ses crédits, ce qui a échoué chez lui — est rassemblé par le serveur : ce sont des
 * faits qu'il ne saurait pas donner, et qu'il ne doit pas pouvoir inventer.
 */
const input = z.object({
  message: z.string().min(1).max(2000),
  screen: z.string().min(1).max(80),
  projectId: z.string().uuid().optional(),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    // Le même rythme que les autres écritures d'un créateur : un signalement est rare, et
    // dix d'affilée ne sont plus un signalement.
    consume(`signalement:${user.id}`, RULES.liaTicket)
    const body = input.parse(await readJson(request))

    await reportProblem({
      userId: user.id,
      screen: body.screen,
      message: body.message,
      ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
    })
    return ok({ received: true }, 201)
  } catch (error) {
    return fail(error)
  }
}
