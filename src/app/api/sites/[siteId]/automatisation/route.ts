import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { ecrireReglages } from '@/server/audit/automatisation'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Ce que la personne autorise à tourner seul, pour un site.
 *
 * Le rythme voyage ici parce qu'il borne une dépense : il est revalidé côté serveur, et pas
 * seulement dans le menu qui l'a envoyé. Une borne d'écran n'est pas une borne.
 */
const input = z.object({
  indexation: z.boolean().optional(),
  releve: z.boolean().optional(),
  redaction: z.boolean().optional(),
  depot: z.boolean().optional(),
  assistants: z.boolean().optional(),
  blogId: z.string().max(200).optional(),
  parPeriode: z.number().int().min(1).max(3).optional(),
  periode: z.enum(['semaine', 'mois']).optional(),
})

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`automatisation:${user.id}`, RULES.aiOperation)
    const { siteId } = await context.params
    const patch = input.parse(await readJson(request))
    return ok({ reglages: await ecrireReglages(user.id, siteId, patch) })
  } catch (error) {
    return fail(error)
  }
}
