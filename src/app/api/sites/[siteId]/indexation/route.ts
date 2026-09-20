import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { inspecter, PAGES_INSPECTEES } from '@/server/audit/indexation'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Demande à Google l'état d'indexation de quelques pages.
 *
 * Gratuite : aucun crédit n'est débité, c'est une lecture d'API sans frais. Mais elle
 * consomme un quota que Google nous impose et dont nous ignorons la hauteur — d'où une
 * borne par appel, et une limite de fréquence par personne. Quelqu'un qui recharge son
 * écran dix fois de suite ne doit pas épuiser sa journée sans s'en rendre compte.
 */
export const maxDuration = 120

const input = z.object({
  urls: z.array(z.string().url().max(2000)).min(1).max(PAGES_INSPECTEES),
})

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`indexation:${user.id}`, RULES.aiOperation)
    const { siteId } = await context.params
    const body = input.parse(await readJson(request))
    return ok(await inspecter(user.id, siteId, body.urls))
  } catch (error) {
    return fail(error)
  }
}
