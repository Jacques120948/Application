import { resolveRuntimeSpec } from '@/server/runtime/context'
import { getEndUser } from '@/server/runtime/end-users'
import { appCheckoutInput, startAppCheckout } from '@/server/runtime/payments'
import { describeStripeError, getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

/** Un visiteur choisit une offre payante : page de paiement sur le compte Stripe du créateur. */
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`paiement:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.appAssistant)
    const input = appCheckoutInput.parse(await readJson(request))
    const runtime = await resolveRuntimeSpec(projectId)
    const endUser = await getEndUser(runtime.projectId)
    return ok(await startAppCheckout(getStripe(), runtime, endUser, input.planId))
  } catch (error) {
    return fail(describeStripeError(error))
  }
}
