import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { ecarterMotCle, proposerMotsCles } from '@/server/ads/ciblage'
import { readDashboard } from '@/server/audit/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Chercher des mots-clés à acheter, ou en écarter un.
 *
 * Aucun crédit n'est débité : ni Search Console ni le planificateur de Google ne font appel
 * à un modèle. Ce sont deux lectures et un calcul. Le quota d'API Google, lui, est partagé
 * entre tous les utilisateurs d'Evoliia — d'où la limite de cadence, et le fait que les
 * chiffres soient conservés plutôt que relus à chaque affichage.
 *
 * Rien ne part chez Google ici. Ce qui sort de cette route vit dans Evoliia jusqu'à ce
 * qu'une personne demande le dépôt, qui passe par `/api/ads/action` avec son journal.
 */
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('chercher'), groupeId: z.string().uuid() }),
  z.object({ action: z.literal('ecarter'), id: z.string().uuid() }),
])

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:ciblage:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))
    if (demande.action === 'ecarter') {
      await ecarterMotCle(user.id, demande.id)
      return ok({ ok: true })
    }

    /*
     * Le site n'est pas une source d'appoint ici, contrairement à la rédaction : c'est la
     * source principale. Sans Search Console, il ne resterait que les idées du planificateur,
     * qui ignore tout de ce que ce site-là gagne déjà sans payer — et proposerait donc
     * d'acheter des recherches obtenues gratuitement. `proposerMotsCles` refuse alors.
     */
    const site = await readDashboard(user.id).catch(() => null)
    const origin = site === null ? null : `https://${site.site.host}`

    const bilan = await proposerMotsCles(user.id, demande.groupeId, origin, 'fr')
    return ok({ ok: true, bilan })
  } catch (error) {
    return fail(error)
  }
}
