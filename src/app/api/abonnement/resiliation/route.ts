import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { describeStripeError, getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { cancelAtPeriodEnd, getSubscriptionView } from '@/server/billing/stripe/subscriptions'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const input = z.object({ cancel: z.boolean() })

/** Résilier à la fin de la période payée, ou revenir sur cette décision. */
export async function POST(request: Request) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    await cancelAtPeriodEnd(getStripe(), user.id, body.cancel)
    return ok({ subscription: await getSubscriptionView(user.id) })
  } catch (error) {
    return fail(describeStripeError(error))
  }
}
