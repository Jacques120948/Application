import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { describeStripeError, getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { startStripeOnboarding } from '@/server/integrations/providers/stripe'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

const input = z.object({ locale: z.enum(SUPPORTED_LOCALES).default('fr') })

/** Commence l'inscription Stripe Connect du créateur : renvoie l'adresse où l'envoyer. */
export async function POST(request: Request) {
  if (!isStripeAvailable()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    return ok({ url: await startStripeOnboarding(getStripe(), user.id, body.locale) })
  } catch (error) {
    return fail(describeStripeError(error))
  }
}
