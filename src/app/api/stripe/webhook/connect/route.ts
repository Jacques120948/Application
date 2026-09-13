import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { handleConnectEvent } from '@/server/runtime/payments'
import { fail, ok } from '@/server/http/respond'
import { logger } from '@/server/observability/logger'

export const maxDuration = 60

/**
 * Webhook Stripe des comptes connectés : les ventes faites dans les applications créées.
 * Secret de signature distinct de celui des abonnements Evoliia.
 */
export async function POST(request: Request) {
  const secret = env.stripeConnectWebhookSecret
  if (secret === undefined || !isStripeAvailable()) return new Response(null, { status: 404 })

  const payload = await request.text()
  const signature = request.headers.get('stripe-signature') ?? ''
  const stripe = getStripe()

  let event
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret)
  } catch {
    return fail(new AppError('UNAUTHENTICATED', 'Signature Stripe invalide.'))
  }

  try {
    const outcome = await handleConnectEvent(stripe, event)
    return ok({ received: true, outcome })
  } catch (error) {
    logger.error('stripe connect : webhook en échec', { type: event.type })
    return fail(error)
  }
}
