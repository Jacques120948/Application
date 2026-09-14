'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { getTranslator, resolveLocale, type MessageKey } from '@/i18n'
import { Badge, Button, Card, CardBody, Notice } from '@/components/ui'
import type { SubscriptionView } from '@/server/billing/stripe/subscriptions'
import type { PlanComparison, PlanDetailGroup } from '@/server/billing/plan-details'

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
  isRecommended: boolean
  /** Ce que l'offre contient, groupé par thème, calculé côté serveur. */
  details: PlanDetailGroup[]
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
  comparison,
  initial,
  paymentAvailable,
  returnState,
  sessionId,
}: {
  locale: string
  plans: PlanCard[]
  comparison: PlanComparison
  initial: SubscriptionView
  paymentAvailable: boolean
  returnState: 'succes' | 'annule' | null
  sessionId: string | null
}) {
  const t = useMemo(() => getTranslator(resolveLocale(locale)), [locale])
  const [subscription, setSubscription] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
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
                  ) : plan.isRecommended ? (
                    <span className="shrink-0 whitespace-nowrap">
                      <Badge tone="neutral">{t('subscription.recommended')}</Badge>
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
                {/*
                  Le contenu exact, groupe par groupe. Une carte qui ne dirait que « 3
                  applications » laisserait deviner le reste ; celle-ci dit tout ce que l'offre
                  ouvre, et le tableau plus bas dit ce qu'elle n'ouvre pas.
                */}
                <div className="mt-4 grid gap-3">
                  {plan.details.map((group) => (
                    <div key={group.title}>
                      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {group.title}
                      </p>
                      <ul className="m-0 mt-1 grid list-none gap-1 p-0 text-sm text-[var(--color-ink-soft)]">
                        {group.items.map((item) => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-0.5 shrink-0 text-[var(--color-brand)]" aria-hidden="true">
                              ✓
                            </span>
                            <span className="min-w-0">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
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

      {/*
        Le tableau complet : chaque ligne pour chaque offre, y compris ce qu'une offre
        n'ouvre pas. Replié par défaut — c'est la lecture attentive, après les cartes — mais
        toujours là, pour que personne ne découvre une limite après avoir payé.
      */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-lg font-semibold">{t('subscription.detailsTitle')}</h2>
              <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">{t('subscription.detailsBody')}</p>
            </div>
            <Button variant="secondary" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails}>
              {showDetails ? t('subscription.hideDetails') : t('subscription.showDetails')}
            </Button>
          </div>
          {showDetails ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left">
                    <th scope="col" className="py-2 pr-4 font-medium text-[var(--color-ink-soft)]">
                      {''}
                    </th>
                    {comparison.planNames.map((name, index) => (
                      <th
                        key={name}
                        scope="col"
                        className={`px-3 py-2 text-center font-semibold ${
                          plans[index]?.id === subscription.planId ? 'text-[var(--color-brand-strong)]' : ''
                        }`}
                      >
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.sections.map((section) => (
                    <Fragment key={section.title}>
                      <tr>
                        <th
                          scope="rowgroup"
                          colSpan={comparison.planNames.length + 1}
                          className="pt-5 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]"
                        >
                          {section.title}
                        </th>
                      </tr>
                      {section.rows.map((row) => (
                        <tr key={row.label} className="border-t border-[var(--color-line)]">
                          <th scope="row" className="py-2 pr-4 text-left font-normal">
                            <span>{row.label}</span>
                            {row.hint !== null ? (
                              <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{row.hint}</span>
                            ) : null}
                          </th>
                          {row.values.map((value, index) => (
                            <td
                              key={comparison.planNames[index]}
                              className={`px-3 py-2 text-center ${
                                plans[index]?.id === subscription.planId ? 'bg-[var(--color-brand-soft)]' : ''
                              }`}
                            >
                              {value === true ? (
                                <span className="font-semibold text-[var(--color-brand)]" aria-label={t('subscription.included')}>
                                  ✓
                                </span>
                              ) : value === false ? (
                                <span className="text-[var(--color-ink-faint)]" aria-label={t('subscription.notIncluded')}>
                                  —
                                </span>
                              ) : (
                                <span className="font-medium">{value}</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
