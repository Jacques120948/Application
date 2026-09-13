import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { handleStripeEvent } from '@/server/billing/stripe/subscriptions'
import { fail, ok } from '@/server/http/respond'
import { logger } from '@/server/observability/logger'

export const maxDuration = 60

/**
 * Webhook Stripe du compte Evoliia : abonnements des créateurs.
 *
 * Le corps est lu brut, jamais analysé avant que la signature ait été vérifiée : un
 * événement non signé n'est pas un événement. Sans secret configuré, la route répond
 * « introuvable », comme si elle n'existait pas.
 */
export async function POST(request: Request) {
  const secret = env.stripeWebhookSecret
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
    const outcome = await handleStripeEvent(stripe, event)
    return ok({ received: true, outcome })
  } catch (error) {
    // Une erreur interne fait réessayer Stripe : c'est ce qu'on veut.
    logger.error('stripe : webhook en échec', { type: event.type })
    return fail(error)
  }
}
