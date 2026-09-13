import { requireUser } from '@/server/auth/session'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { checkoutInput, getSubscriptionView, startCheckout } from '@/server/billing/stripe/subscriptions'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Abonnement Evoliia du créateur.
 *
 * GET relit l'état connu. POST commence un paiement — ou, pour un abonné Stripe, change
 * d'offre directement. Sans Stripe configuré, la route n'existe pas.
 */
export async function GET() {
  try {
    const user = await requireUser()
    return ok({ subscription: await getSubscriptionView(user.id), paymentAvailable: isStripeAvailable() })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = checkoutInput.parse(await readJson(request))
    const result = await startCheckout(getStripe(), user.id, input)
    if ('url' in result) return ok({ url: result.url })
    return ok({ changed: true, subscription: await getSubscriptionView(user.id) })
  } catch (error) {
    return fail(error)
  }
}
