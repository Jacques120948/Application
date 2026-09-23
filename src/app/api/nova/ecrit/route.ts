import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { ecrireNova } from '@/server/nova/ecrits'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Une synthèse ou une analyse approfondie de Nova, sur la période affichée. Payée en crédits,
 * au coût réel de l'appel ; le droit et le solde sont vérifiés côté serveur.
 */
export const maxDuration = 120

const input = z.object({
  genre: z.enum(['synthese', 'approfondie']),
  periode: z.string().max(20).optional(),
  du: z.string().max(10).optional(),
  au: z.string().max(10).optional(),
  siteId: z.string().uuid().optional(),
  locale: z.string().max(5).default('fr'),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { genre, locale, ...options } = input.parse(await readJson(request))
    const ecrit = await ecrireNova(user.id, genre, locale, options)
    return ok({ ecrit })
  } catch (error) {
    return fail(error)
  }
}
