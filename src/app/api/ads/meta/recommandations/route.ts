import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { ecarterMeta, evaluerCompteMeta } from '@/server/ads/recommandations-meta'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Ce qu'on fait d'un constat de MIRA.
 *
 * Deux gestes, et aucun ne touche à Meta. « Écarter » range le constat et le tait pendant un
 * mois ; « réexaminer » repasse les règles sur les chiffres déjà lus. Les deux sont
 * gratuits : pas un crédit, pas un appel à un modèle, pas une requête chez Meta — ce sont
 * des lectures en base et des comparaisons de nombres.
 *
 * L'identifiant vient du navigateur et n'ouvre rien : `ecarterMeta` ne le cherche que parmi
 * les constats de cette personne, et refuse celui qui n'est pas à elle comme un introuvable.
 * Ce qui arrive du navigateur désigne, il n'autorise pas.
 */
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ecarter'), id: z.string().uuid() }),
  z.object({ action: z.literal('evaluer') }),
])

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:meta:reco:${user.id}`, RULES.aiOperation)
    /*
     * Le droit de l'agent publicitaire, comme partout chez MIRA tant que sa fiche n'est
     * ouverte à aucune offre : verrouiller sur un droit que personne ne possède fermerait
     * l'écran à celui-là même qui vient de relier son compte.
     */
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))
    if (demande.action === 'ecarter') {
      await ecarterMeta(user.id, demande.id)
      return ok({ ok: true })
    }

    const issue = await evaluerCompteMeta(user.id)
    if (!issue.ok) return ok({ ok: false, raison: issue.raison })
    return ok({ ok: true, bilan: issue.bilan })
  } catch (error) {
    return fail(error)
  }
}
