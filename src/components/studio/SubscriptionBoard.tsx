'use client'

import { useEffect, useMemo, useState } from 'react'
import { getTranslator, resolveLocale, type MessageKey } from '@/i18n'
import { Badge, Button, Card, CardBody, Notice } from '@/components/ui'
import type { SubscriptionView } from '@/server/billing/stripe/subscriptions'

export type PlanCard = {
  id: string
  name: string
  description: string
  priceCents: number
  currency: string
  interval: string
  monthlyCredits: number
  maxProjects: number
  allowBuild: boolean
}

/**
 * Écran « Abonnement ».
 *
 * Tout ce qui touche à l'argent part vers Stripe : choisir une offre ouvre la page de
 * paiement Stripe, gérer sa carte ouvre le portail Stripe. Ici on ne saisit rien de
 * sensible, on ne fait que des choix.
 */
export function SubscriptionBoard({
  locale,
  plans,
  initial,
  paymentAvailable,
  returnState,
  sessionId,
}: {
  locale: string
  plans: PlanCard[]
  initial: SubscriptionView
  paymentAvailable: boolean
  returnState: 'succes' | 'annule' | null
  sessionId: string | null
}) {
  const t = useMemo(() => getTranslator(resolveLocale(locale)), [locale])
  const [subscription, setSubscription] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'positive' | 'caution' | 'critical'; text: string } | null>(
    returnState === 'annule' ? { tone: 'caution', text: t('subscription.canceledCheckout') } : null,
  )

  /*
   * Au retour d'un paiement réussi, on demande au serveur de relire la session chez
   * Stripe. Le webhook a probablement déjà tout fait ; sinon, c'est fait maintenant.
   */
  useEffect(() => {
    if (returnState !== 'succes' || sessionId === null || !paymentAvailable) return
    let cancelled = false
    void (async () => {
      const response = await fetch('/api/abonnement/retour', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        applied?: boolean
        subscription?: SubscriptionView
      }
      if (cancelled) return
      if (body.subscription !== undefined) setSubscription(body.subscription)
      setMessage(
        body.applied === true && body.subscription?.status !== 'FREE'
          ? { tone: 'positive', text: t('subscription.succeeded') }
          : { tone: 'caution', text: t('subscription.pending') },
      )
      // L'identifiant de session n'a plus à rester dans l'adresse.
      window.history.replaceState(null, '', window.location.pathname)
    })()
    return () => {
      cancelled = true
    }
  }, [returnState, sessionId, paymentAvailable, t])

  async function call(path: string, payload: Record<string, unknown>, key: string): Promise<void> {
    setBusy(key)
    setMessage(null)
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as {
        message?: string
        url?: string
        subscription?: SubscriptionView
      }
      if (!response.ok) {
        setMessage({ tone: 'critical', text: body.message ?? t('subscription.error') })
        return
      }
      if (body.url !== undefined) {
        window.location.assign(body.url)
        return
      }
      if (body.subscription !== undefined) {
        setSubscription(body.subscription)
        setMessage({ tone: 'positive', text: t('subscription.succeeded') })
      }
    } finally {
      setBusy(null)
    }
  }

  const periodEnd =
    subscription.currentPeriodEnd === null
      ? null
      : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(subscription.currentPeriodEnd))
  const statusKey = `subscription.status${subscription.status}` as MessageKey
  const statusTone =
    subscription.status === 'ACTIVE' || subscription.status === 'TRIALING'
      ? 'positive'
      : subscription.status === 'PAST_DUE'
        ? 'caution'
        : 'neutral'

  return (
    <div className="grid gap-6">
      {message !== null ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {!paymentAvailable ? <Notice tone="neutral">{t('subscription.unavailable')}</Notice> : null}

      <Card>
        <CardBody>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            {t('subscription.current')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="m-0 text-2xl font-semibold">{subscription.planName}</h2>
            <Badge tone={statusTone}>{t(statusKey)}</Badge>
          </div>
          {periodEnd !== null ? (
            <p className="m-0 mt-2 text-sm text-[var(--color-ink-soft)]">
              {subscription.cancelAtPeriodEnd
                ? t('subscription.endsOn', { date: periodEnd })
                : t('subscription.renewsOn', { date: periodEnd })}
            </p>
          ) : null}
          {subscription.cancelAtPeriodEnd ? (
            <p className="m-0 mt-2 text-sm text-[var(--color-caution)]">{t('subscription.cancelScheduled')}</p>
          ) : null}
          {subscription.status === 'PAST_DUE' ? (
            <p className="m-0 mt-2 text-sm text-[var(--color-caution)]">{t('subscription.pastDue')}</p>
          ) : null}
          {subscription.status !== 'FREE' && !subscription.managedByStripe ? (
            <p className="m-0 mt-2 text-sm text-[var(--color-ink-soft)]">{t('subscription.manual')}</p>
          ) : null}

          {paymentAvailable && subscription.managedByStripe ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void call('/api/abonnement/portail', { locale }, 'portal')}
              >
                {busy === 'portal' ? t('subscription.working') : t('subscription.portal')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() =>
                  void call('/api/abonnement/resiliation', { cancel: !subscription.cancelAtPeriodEnd }, 'cancel')
                }
              >
                {busy === 'cancel'
                  ? t('subscription.working')
                  : subscription.cancelAtPeriodEnd
                    ? t('subscription.resume')
                    : t('subscription.cancel')}
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const current = plan.id === subscription.planId
          const canChoose =
            paymentAvailable &&
            plan.priceCents > 0 &&
            !current &&
            (subscription.status === 'FREE' || subscription.managedByStripe)
          return (
            <Card key={plan.id} className={current ? 'border-[var(--color-brand)]' : ''}>
              <CardBody className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-base font-semibold">{plan.name}</h3>
                  {current ? (
                    <span className="shrink-0 whitespace-nowrap">
                      <Badge tone="brand">{t('subscription.yours')}</Badge>
                    </span>
                  ) : null}
                </div>
                <p className="m-0 mt-2 text-2xl font-semibold">
                  {plan.priceCents === 0
                    ? t('subscription.free')
                    : new Intl.NumberFormat(locale, { style: 'currency', currency: plan.currency }).format(
                        plan.priceCents / 100,
                      )}
                  {plan.priceCents > 0 ? (
                    <span className="ml-1 text-sm font-normal text-[var(--color-ink-soft)]">
                      {plan.interval === 'year' ? t('subscription.perYear') : t('subscription.perMonth')}
                    </span>
                  ) : null}
                </p>
                <p className="m-0 mt-2 text-sm text-[var(--color-ink-soft)]">{plan.description}</p>
                <ul className="m-0 mt-3 grid list-none gap-1 p-0 text-sm text-[var(--color-ink-soft)]">
                  <li>{t('subscription.credits', { count: plan.monthlyCredits })}</li>
                  {plan.allowBuild ? <li>{t('subscription.projects', { count: plan.maxProjects })}</li> : null}
                </ul>
                <div className="mt-auto pt-4">
                  {canChoose ? (
                    <Button
                      className="w-full"
                      disabled={busy !== null}
                      onClick={() => void call('/api/abonnement', { planId: plan.id, locale }, plan.id)}
                    >
                      {busy === plan.id
                        ? t('subscription.working')
                        : subscription.status === 'FREE'
                          ? t('subscription.choose')
                          : t('subscription.change')}
                    </Button>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
      {paymentAvailable && subscription.managedByStripe ? (
        <p className="m-0 text-xs text-[var(--color-ink-faint)]">{t('subscription.prorata')}</p>
      ) : null}
    </div>
  )
}
