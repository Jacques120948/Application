import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { getSubscriptionView, syncCheckoutSession } from '@/server/billing/stripe/subscriptions'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const input = z.object({ sessionId: z.string().trim().min(1).max(200) })

/**
 * Retour d'un paiement. Le webhook fait foi ; cette route ne sert qu'à ne pas faire
 * attendre la personne s'il tarde. La session est relue chez Stripe, jamais crue.
 */
export async function POST(request: Request) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    const applied = await syncCheckoutSession(getStripe(), user.id, body.sessionId)
    return ok({ applied, subscription: await getSubscriptionView(user.id) })
  } catch (error) {
    return fail(error)
  }
}
