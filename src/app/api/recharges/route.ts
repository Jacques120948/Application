import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { describeStripeError, getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { commencerRecharge, rechargeInput } from '@/server/billing/stripe/recharges'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Acheter une recharge de crédits.
 *
 * Le navigateur n'envoie qu'un identifiant de pack ; la route rend l'adresse de la page de
 * paiement Stripe, et rien d'autre ne change. Les crédits arrivent par le webhook, une fois
 * le paiement confirmé. Sans Stripe configuré, la route n'existe pas.
 */
export async function POST(request: Request) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`recharge:${user.id}`, RULES.aiOperation)
    const input = rechargeInput.parse(await readJson(request))
    return ok(await commencerRecharge(getStripe(), user.id, input))
  } catch (error) {
    return fail(describeStripeError(error))
  }
}
