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
  /** Prix pour douze mois payés d'avance. Zéro : cette offre se prend au mois seulement. */
  priceYearCents: number
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
  /*
   * Le mois par défaut, toujours. Ouvrir sur l'année ferait lire le plus gros nombre en
   * premier, ce qui fait fuir quelqu'un qui découvre les prix — et donnerait l'impression
   * d'un engagement imposé. C'est une économie qu'on propose, pas une condition.
   */
  const [rythme, setRythme] = useState<'mois' | 'an'>('mois')

  /*
   * La remise se calcule à partir des deux prix, jamais d'un taux réglé à part : deux
   * nombres qui devraient s'accorder finissent toujours par diverger, et un client repère
   * l'écart en une multiplication. Arrondie vers le bas — annoncer 20 % pour 19,7 % est
   * une exagération, annoncer 19 % n'en est pas une.
   */
  const remiseDe = (plan: PlanCard): number | null => {
    if (plan.priceCents <= 0 || plan.priceYearCents <= 0) return null
    const plein = plan.priceCents * 12
    if (plan.priceYearCents >= plein) return null
    return Math.floor(((plein - plan.priceYearCents) / plein) * 100)
  }

  const annuelPossible = plans.some((plan) => plan.priceYearCents > 0)
  const remises = plans.map(remiseDe).filter((valeur): valeur is number => valeur !== null)
  /* La plus forte, sur le bouton : c'est ce qui décide d'aller voir, pas une moyenne. */
  const remiseMax = remises.length === 0 ? null : Math.max(...remises)

  const argent = (cents: number): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: plans[0]?.currency ?? 'CHF',
    }).format(cents / 100)
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

      {/*
        Le choix du rythme, au-dessus de la grille et non dans chaque carte : c'est une
        décision qu'on prend une fois pour toutes les offres, et la répéter quatre fois
        laisserait croire qu'on peut payer Starter au mois et Pro à l'année en même temps.
        Il n'apparaît que si une offre au moins a un tarif annuel — sinon c'est un
        interrupteur sans effet, et rien ne fait douter d'une page de prix comme un bouton
        qui ne change rien.
      */}
      {annuelPossible ? (
        <div className="flex flex-wrap items-center gap-2">
          {(['mois', 'an'] as const).map((choix) => {
            const actif = choix === rythme
            return (
              <button
                key={choix}
                type="button"
                onClick={() => setRythme(choix)}
                aria-pressed={actif}
                className={`cursor-pointer rounded-[var(--radius-pill)] border px-4 py-2 text-sm ${
                  actif
                    ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                    : 'border-[var(--color-line)] bg-transparent text-[var(--color-ink-soft)]'
                }`}
              >
                {choix === 'mois' ? t('subscription.payMonthly') : t('subscription.payYearly')}
                {choix === 'an' && remiseMax !== null ? (
                  <span className="ml-2 text-xs">{t('subscription.yearlyOff', { percent: remiseMax })}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const current = plan.id === subscription.planId
          /*
           * L'année demandée pour une offre qui n'en a pas : on montre son prix mensuel et
           * on le dit. La masquer ferait disparaître une offre au changement de rythme,
           * et personne ne comprendrait qu'elle existe encore.
           */
          const annuel = rythme === 'an' && plan.priceYearCents > 0
          const montant = annuel ? plan.priceYearCents : plan.priceCents
          const remise = remiseDe(plan)
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
                  {plan.priceCents === 0 ? t('subscription.free') : argent(montant)}
                  {plan.priceCents > 0 ? (
                    <span className="ml-1 text-sm font-normal text-[var(--color-ink-soft)]">
                      {annuel || plan.interval === 'year'
                        ? t('subscription.perYear')
                        : t('subscription.perMonth')}
                    </span>
                  ) : null}
                </p>
                {/*
                  Ce que l'année revient au mois, et ce qu'elle fait gagner. Le pourcentage
                  seul ne dit rien à qui compare un prix mensuel : c'est la division qui
                  permet de décider, et elle est faite ici plutôt que laissée au client.
                */}
                {annuel && remise !== null ? (
                  <p className="m-0 mt-1 text-xs text-[var(--color-brand-strong)]">
                    {t('subscription.yearlyEquivalent', {
                      amount: argent(Math.round(plan.priceYearCents / 12)),
                      percent: remise,
                    })}
                  </p>
                ) : rythme === 'an' && plan.priceCents > 0 ? (
                  <p className="m-0 mt-1 text-xs text-[var(--color-ink-faint)]">
                    {t('subscription.monthlyOnly')}
                  </p>
                ) : null}
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
                      onClick={() =>
                        void call(
                          '/api/abonnement',
                          // Le rythme réellement payable pour cette offre, pas celui de
                          // l'écran : demander l'année à une offre qui n'en a pas serait
                          // refusé côté serveur, et l'échec arriverait après le clic.
                          { planId: plan.id, rythme: annuel ? 'an' : 'mois', locale },
                          plan.id,
                        )
                      }
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
