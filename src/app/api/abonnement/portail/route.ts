import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { openPortal } from '@/server/billing/stripe/subscriptions'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

const input = z.object({ locale: z.enum(SUPPORTED_LOCALES).default('fr') })

/** Le portail Stripe : factures, moyen de paiement, résiliation. */
export async function POST(request: Request) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    return ok({ url: await openPortal(getStripe(), user.id, body.locale) })
  } catch (error) {
    return fail(error)
  }
}
