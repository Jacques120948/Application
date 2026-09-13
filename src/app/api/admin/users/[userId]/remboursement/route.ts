import { refundInput, refundUserPayment } from '@/server/admin/service'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Rembourser la dernière facture d'un abonné, et fermer son abonnement si demandé. */
export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const { userId } = await context.params
    const input = refundInput.parse(await readJson(request))
    return ok(await refundUserPayment(getStripe(), userId, input))
  } catch (error) {
    return fail(error)
  }
}
