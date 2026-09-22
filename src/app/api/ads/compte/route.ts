import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { choisirCompte, retirerCompte } from '@/server/ads/comptes'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Désigne le compte publicitaire que l'agent suit, ou en retire un devenu illisible.
 *
 * L'identifiant vient du navigateur, et il n'ouvre rien : `choisirCompte` ne le cherche que
 * parmi les comptes de cette personne, et refuse un compte qui n'est pas à elle comme un
 * compte introuvable. C'est la même règle que partout ailleurs — ce qui arrive du navigateur
 * désigne, il n'autorise pas.
 */
const input = z.object({
  compteId: z.string().uuid(),
  /*
   * « suivre » par défaut, et pas seulement par commodité : c'est le geste anodin. Un geste
   * destructeur doit être demandé nommément, jamais obtenu en omettant un champ.
   */
  geste: z.enum(['suivre', 'retirer']).default('suivre'),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:compte:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')
    const demande = input.parse(await readJson(request))
    if (demande.geste === 'retirer') {
      await retirerCompte(user.id, demande.compteId)
      return ok({ retire: true })
    }
    return ok({ compte: await choisirCompte(user.id, demande.compteId) })
  } catch (error) {
    return fail(error)
  }
}
