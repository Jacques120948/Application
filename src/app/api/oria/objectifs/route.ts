import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { enregistrerObjectifs, objectifsInput } from '@/server/oria/objectifs'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les objectifs de l'entreprise, pour un site.
 *
 * Tout est revalidé derrière : l'objectif doit exister, avoir un agent qui y travaille, et
 * le site doit appartenir à la personne. Le formulaire n'est qu'une façon commode de
 * demander.
 */
const input = objectifsInput.extend({ siteId: z.string().uuid() })

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`oria-objectifs:${user.id}`, RULES.aiOperation)
    const { siteId, ...reste } = input.parse(await readJson(request))
    return ok({ objectifs: await enregistrerObjectifs(user.id, siteId, reste) })
  } catch (error) {
    return fail(error)
  }
}
