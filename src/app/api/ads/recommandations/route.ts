import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { ecarter, evaluerCompte } from '@/server/ads/recommandations'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Ce qu'on fait d'une recommandation.
 *
 * Deux gestes seulement, et aucun ne touche à Google. « Écarter » range l'avis et le tait
 * pendant un mois ; « réexaminer » repasse les règles sur les chiffres déjà lus. Les deux
 * sont gratuits : pas un crédit, pas un appel à un modèle, pas une requête chez Google — ce
 * sont des lectures en base et des comparaisons de nombres.
 *
 * L'identifiant vient du navigateur et n'ouvre rien : `ecarter` ne le cherche que parmi les
 * recommandations de cette personne, et refuse celle qui n'est pas à elle comme une
 * introuvable. Ce qui arrive du navigateur désigne, il n'autorise pas.
 */
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ecarter'), id: z.string().uuid() }),
  z.object({ action: z.literal('evaluer') }),
])

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:reco:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))
    if (demande.action === 'ecarter') {
      await ecarter(user.id, demande.id)
      return ok({ ok: true })
    }

    const issue = await evaluerCompte(user.id)
    if (!issue.ok) return ok({ ok: false, raison: issue.raison })
    return ok({ ok: true, bilan: issue.bilan })
  } catch (error) {
    return fail(error)
  }
}
