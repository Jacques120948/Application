import { z } from 'zod'
import { resolveLocale } from '@/i18n'
import { requireUser } from '@/server/auth/session'
import { ecrireResume } from '@/server/oria/resume'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Demander un résumé à Oria. C'est la seule route d'Oria qui débite des crédits : elle
 * n'est appelée que sur un clic, jamais à l'ouverture d'un écran.
 */
const input = z.object({
  genre: z.enum(['jour', 'semaine']),
  siteId: z.string().uuid().optional(),
  locale: z.string().max(8).optional(),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { genre, siteId, locale } = input.parse(await readJson(request))
    return ok({ resume: await ecrireResume(user.id, genre, resolveLocale(locale ?? 'fr'), siteId) })
  } catch (error) {
    return fail(error)
  }
}
