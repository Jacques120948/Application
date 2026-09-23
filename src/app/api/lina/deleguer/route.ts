import { z } from 'zod'
import { resolveLocale } from '@/i18n'
import { requireUser } from '@/server/auth/session'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { deleguerLina } from '@/server/lina/delegation'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Lina confie une campagne à Milo, ou les paniers perdus à Cleo, sur un clic.
 *
 * Le navigateur n'envoie qu'une clé et un destinataire : la question est écrite côté serveur,
 * avec les seuls totaux du segment. Les crédits sont ceux d'une question à un spécialiste.
 */
const input = z.object({
  cle: z.string().min(1).max(120),
  agent: z.enum(['content', 'cro', 'meta', 'ads', 'seo', 'geo']),
  siteId: z.string().uuid().optional(),
  locale: z.string().max(8).optional(),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    const { locale, ...entree } = input.parse(await readJson(request))
    return ok({ note: await deleguerLina(user.id, entree, resolveLocale(locale ?? 'fr')) })
  } catch (error) {
    return fail(error)
  }
}
