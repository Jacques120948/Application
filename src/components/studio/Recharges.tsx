'use client'

import { useMemo, useState } from 'react'
import { getTranslator, resolveLocale } from '@/i18n'
import { Badge, Button, Notice } from '@/components/ui'

export type PackCard = {
  id: string
  credits: number
  priceCents: number
  currency: string
  isRecommended: boolean
}

/**
 * Les recharges de crédits, sur la page Abonnement.
 *
 * Le bouton n'envoie qu'un identifiant de pack : le prix et le nombre de crédits sont
 * décidés par le serveur, et les crédits arrivent par le webhook de Stripe. Au retour du
 * paiement, cet écran ne crédite donc rien et ne l'annonce pas comme fait : il dit que le
 * paiement est reçu et que les crédits arrivent.
 */
export function Recharges({
  locale,
  packs,
  paymentAvailable,
  purchased,
  monthly,
  returnState,
}: {
  locale: string
  packs: PackCard[]
  paymentAvailable: boolean
  /** Crédits achetés encore disponibles. */
  purchased: number
  /** Ce qui reste de la réserve mensuelle. */
  monthly: number
  returnState: 'succes' | 'annulee' | null
}) {
  const t = useMemo(() => getTranslator(resolveLocale(locale)), [locale])
  const [busy, setBusy] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const argent = (cents: number, currency: string): string =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
  /* Le prix du crédit, à deux décimales : c'est ce qui se compare d'un pack à l'autre. */
  const unite = (pack: PackCard): string =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: pack.currency, minimumFractionDigits: 2 }).format(
      pack.priceCents / 100 / pack.credits,
    )

  async function acheter(packId: string): Promise<void> {
    setBusy(packId)
    setErreur(null)
    try {
      const response = await fetch('/api/recharges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packId, locale }),
      })
      const body = (await response.json().catch(() => ({}))) as { url?: string; message?: string }
      if (!response.ok || body.url === undefined) {
        setErreur(body.message ?? t('recharges.error'))
        return
      }
      window.location.assign(body.url)
    } catch {
      setErreur(t('recharges.error'))
    } finally {
      setBusy(null)
    }
  }

  if (packs.length === 0) return null

  return (
    <section id="recharges" className="mt-14 scroll-mt-20">
      <h2 className="mb-1 text-xl font-semibold">{t('vis.packsTitle')}</h2>
      <p className="mt-0 mb-6 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
        {t('vis.packsBody')}
      </p>

      {returnState === 'succes' ? (
        <div className="mb-6">
          <Notice tone="positive">{t('recharges.received')}</Notice>
        </div>
      ) : returnState === 'annulee' ? (
        <div className="mb-6">
          <Notice tone="caution">{t('subscription.canceledCheckout')}</Notice>
        </div>
      ) : null}
      {erreur !== null ? (
        <div className="mb-6">
          <Notice tone="critical">{erreur}</Notice>
        </div>
      ) : null}

      <p className="mt-0 mb-6 text-sm text-[var(--color-ink-soft)]">
        {t('recharges.balance', { monthly, purchased })}
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className={
              pack.isRecommended
                ? 'flex flex-col rounded-[var(--radius-card)] border border-[var(--color-brand)]/40 bg-[var(--color-brand-soft)] p-6'
                : 'flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6'
            }
          >
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-base font-semibold">{t('vis.packsCredits', { count: pack.credits })}</p>
              {pack.isRecommended ? <Badge tone="brand">{t('recharges.recommended')}</Badge> : null}
            </div>
            <p className="mt-2 mb-0 text-2xl font-semibold tracking-tight">{argent(pack.priceCents, pack.currency)}</p>
            <p className="mt-1 mb-5 text-xs text-[var(--color-ink-faint)]">
              {t('recharges.perCredit', { price: unite(pack) })}
            </p>
            {paymentAvailable ? (
              <Button
                className="mt-auto"
                variant={pack.isRecommended ? 'primary' : 'secondary'}
                disabled={busy !== null}
                onClick={() => void acheter(pack.id)}
              >
                {busy === pack.id ? t('subscription.working') : t('recharges.buy')}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-4 mb-0 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-faint)]">
        {paymentAvailable ? t('recharges.note') : t('recharges.unavailable')}
      </p>
    </section>
  )
}
