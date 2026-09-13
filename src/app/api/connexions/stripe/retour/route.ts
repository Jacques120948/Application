import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getStripe, isStripeAvailable } from '@/server/billing/stripe/client'
import { completeStripeOnboarding } from '@/server/integrations/providers/stripe'
import { logger } from '@/server/observability/logger'

/**
 * Retour de la page d'inscription Stripe. Aucune donnée n'est lue dans l'adresse : le
 * compte est relu chez Stripe, et la personne est celle de la session Evoliia.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const locale = resolveLocale(url.searchParams.get('locale') ?? 'fr')
  if (!isStripeAvailable()) redirect(`/${locale}/connexions`)

  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  let outcome = 'erreur'
  try {
    outcome = await completeStripeOnboarding(getStripe(), user.id)
  } catch (error) {
    logger.warn('stripe connect : retour en échec', {
      reason: error instanceof Error ? error.message : 'inconnu',
    })
  }
  redirect(`/${locale}/connexions?stripe=${outcome}`)
}
