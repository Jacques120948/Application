import { z } from 'zod'
import { resolveLocale } from '@/i18n'
import { requireUser } from '@/server/auth/session'
import { VISIBILITY_AGENT_IDS } from '@/server/agents/visibility'
import { deleguerNova } from '@/server/nova/delegation'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Nova transmet une mesure à un spécialiste, sur un clic.
 *
 * Le navigateur n'envoie que l'identifiant du point et le destinataire : la question est
 * écrite côté serveur, et le point relu parmi ceux de la personne. Les crédits sont ceux
 * d'une question à un spécialiste, débités par le même chemin.
 */
const input = z.object({
  cle: z.string().min(1).max(200),
  agent: z.enum(VISIBILITY_AGENT_IDS),
  siteId: z.string().uuid().optional(),
  locale: z.string().max(8).optional(),
  periode: z.string().max(12).optional(),
  du: z.string().max(10).optional(),
  au: z.string().max(10).optional(),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { locale, ...entree } = input.parse(await readJson(request))
    return ok({ note: await deleguerNova(user.id, entree, resolveLocale(locale ?? 'fr')) })
  } catch (error) {
    return fail(error)
  }
}
