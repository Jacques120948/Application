import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet, partMensuelle } from '@/server/billing/credits'
import { creditPacks } from '@/server/billing/packs'
import { comparePlans, planDetails } from '@/server/billing/plan-details'
import { actionCosts } from '@/server/billing/action-costs'
import { listPublicPlans } from '@/server/billing/plans'
import { isStripeAvailable } from '@/server/billing/stripe/client'
import { getSubscriptionView } from '@/server/billing/stripe/subscriptions'
import { Shell } from '@/components/studio/Shell'
import { SubscriptionBoard, type PlanCard } from '@/components/studio/SubscriptionBoard'
import { Recharges } from '@/components/studio/Recharges'

/**
 * L'abonnement du créateur.
 *
 * La page lit ce qu'Evoliia sait, jamais Stripe directement : le webhook a déjà fait le
 * travail. Au retour d'un paiement, le navigateur demande une relecture de la session,
 * au cas où le webhook tarde — mais c'est une commodité, pas la source de vérité.
 */
export default async function SubscriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ etat?: string; session_id?: string; recharge?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const { etat, session_id: sessionId, recharge } = await searchParams
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const [plans, subscription, wallet, couts, packs] = await Promise.all([
    listPublicPlans(),
    getSubscriptionView(user.id),
    getWallet(user.id),
    // Pour traduire la réserve en articles, pages et foires aux questions. Voir volumes-offre.
    actionCosts(),
    creditPacks(),
  ])
  const t = getTranslator(locale)

  const cards: PlanCard[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents,
    priceYearCents: plan.priceYearCents,
    currency: plan.currency,
    interval: plan.interval,
    monthlyCredits: plan.monthlyCredits,
    maxProjects: plan.maxProjects,
    allowBuild: plan.allowBuild,
    isRecommended: plan.isRecommended,
    details: planDetails(plan, locale, couts),
  }))
  const comparison = comparePlans(plans, locale)

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="abonnement"
      menu="abonnement"
    >
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">{t('subscription.title')}</h1>
        <p className="mb-8 text-[var(--color-ink-soft)]">{t('subscription.subtitle')}</p>
        <SubscriptionBoard
          locale={locale}
          plans={cards}
          comparison={comparison}
          initial={subscription}
          paymentAvailable={isStripeAvailable()}
          returnState={etat === 'succes' ? 'succes' : etat === 'annule' ? 'annule' : null}
          sessionId={sessionId ?? null}
        />
        <Recharges
          locale={locale}
          packs={packs.map((pack) => ({ ...pack }))}
          paymentAvailable={isStripeAvailable()}
          purchased={wallet.purchased}
          monthly={partMensuelle(wallet)}
          returnState={recharge === 'succes' ? 'succes' : recharge === 'annulee' ? 'annulee' : null}
        />
      </div>
    </Shell>
  )
}
