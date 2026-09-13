import { requireUser } from '@/server/auth/session'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { refundInput, refundPurchase } from '@/server/runtime/payments'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Le créateur rembourse une vente de son application, depuis son compte Stripe. */
export async function POST(request: Request, context: { params: Promise<{ id: string; purchaseId: string }> }) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id, purchaseId } = await context.params
    const input = refundInput.parse(await readJson(request))
    return ok({ purchase: await refundPurchase(getStripe(), user.id, id, purchaseId, input) })
  } catch (error) {
    return fail(error)
  }
}
