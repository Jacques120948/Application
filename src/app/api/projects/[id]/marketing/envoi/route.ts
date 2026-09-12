import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { sendWeekToSocial } from '@/server/marketing/publish'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 40

const input = z.object({ kitId: z.string().uuid() })

/**
 * Dépose la semaine approuvée dans l'espace Postelya du créateur.
 *
 * Rien n'est publié sur un réseau social : tout arrive en brouillon, où le créateur relit
 * et programme lui-même. L'opération est rejouable sans dommage, Postelya refusant de créer
 * deux fois la même publication.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { kitId } = input.parse(await readJson(request))
    return ok(await sendWeekToSocial(user.id, kitId))
  } catch (error) {
    return fail(error)
  }
}
