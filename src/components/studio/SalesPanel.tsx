'use client'

import { useEffect, useState } from 'react'
import { Button, Card, CardBody, LinkButton, Notice } from '@/components/ui'
import type { SalesView } from '@/server/runtime/payments'

const STATUS_LABEL: Record<string, string> = {
  paid: 'Payé',
  active: 'Abonnement actif',
  past_due: 'Paiement en retard',
  canceled: 'Résilié',
  refunded: 'Remboursé',
}

/**
 * Les ventes d'une application, dans l'onglet Monétisation.
 *
 * Trois états, dits franchement : le paiement n'est pas activé sur l'installation, le
 * créateur n'a pas relié son compte Stripe, ou les ventes sont là. Les montants sont
 * ceux que Stripe a confirmés — jamais une estimation.
 */
export function SalesPanel({ projectId, locale }: { projectId: string; locale: string }) {
  const [sales, setSales] = useState<SalesView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  /**
   * Rembourser depuis Evoliia. Une confirmation avant : l'argent repart du compte du
   * créateur et un abonnement remboursé est résilié sur-le-champ.
   */
  async function refund(purchase: SalesView['purchases'][number]) {
    const what =
      purchase.mode === 'subscription'
        ? `Résilier l’abonnement de ${purchase.email ?? 'ce client'} et rembourser sa dernière facture ?`
        : `Rembourser ${new Intl.NumberFormat(locale, { style: 'currency', currency: purchase.currency }).format(
            (purchase.amountCents - purchase.refundedCents) / 100,
          )} à ${purchase.email ?? 'ce client'} ?`
    if (!window.confirm(what)) return
    setBusy(purchase.id)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/ventes/${purchase.id}/remboursement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const body = (await response.json().catch(() => ({}))) as {
      message?: string
      purchase?: SalesView['purchases'][number]
    }
    setBusy(null)
    if (!response.ok || body.purchase === undefined) {
      setError(body.message ?? 'Le remboursement n’a pas abouti.')
      return
    }
    const refunded = body.purchase
    setSales((current) => {
      if (current === null) return current
      const purchases = current.purchases.map((row) => (row.id === refunded.id ? refunded : row))
      return {
        ...current,
        purchases,
        totals: {
          ...current.totals,
          amountCents: purchases.reduce((sum, row) => sum + row.amountCents - row.refundedCents, 0),
          refundedCents: purchases.reduce((sum, row) => sum + row.refundedCents, 0),
          count: purchases.filter((row) => row.status !== 'refunded').length,
          activeSubscriptions: purchases.filter((row) => row.mode === 'subscription' && row.status === 'active').length,
        },
      }
    })
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const response = await fetch(`/api/projects/${projectId}/ventes`)
      const body = (await response.json().catch(() => ({}))) as SalesView & { message?: string }
      if (cancelled) return
      if (!response.ok) {
        setError(body.message ?? 'Les ventes n’ont pas pu être chargées.')
        return
      }
      setSales(body)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (error !== null) return <Notice tone="critical">{error}</Notice>
  if (sales === null) return <p className="text-sm text-[var(--color-ink-soft)]">Chargement des ventes…</p>

  if (!sales.available) {
    return (
      <Notice tone="neutral" title="Encaisser vos clients">
        Le paiement en ligne n&apos;est pas activé sur cette installation. Vos tarifs restent
        affichés à titre d&apos;information.
      </Notice>
    )
  }

  if (!sales.connected) {
    return (
      <Card>
        <CardBody>
          <h3 className="mt-0 text-sm font-semibold">Encaisser vos clients</h3>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            Reliez votre compte Stripe pour que vos offres payantes se choisissent vraiment.
            L&apos;argent arrive sur votre compte, jamais sur celui d&apos;Evoliia.
          </p>
          <LinkButton href={`/${locale}/connexions`} className="mt-4">
            Relier mon compte Stripe
          </LinkButton>
        </CardBody>
      </Card>
    )
  }

  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)

  return (
    <div className="grid gap-4">
      <Card>
        <CardBody>
          <h3 className="mt-0 text-sm font-semibold">Vos ventes</h3>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <p className="m-0 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">Encaissé</p>
              <p className="m-0 mt-1 text-xl font-semibold">
                {sales.totals.currency === null ? '—' : money(sales.totals.amountCents, sales.totals.currency)}
              </p>
            </div>
            <div>
              <p className="m-0 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">Paiements</p>
              <p className="m-0 mt-1 text-xl font-semibold">{sales.totals.count}</p>
            </div>
            <div>
              <p className="m-0 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">Abonnés actifs</p>
              <p className="m-0 mt-1 text-xl font-semibold">{sales.totals.activeSubscriptions}</p>
            </div>
            {sales.totals.refundedCents > 0 && sales.totals.currency !== null ? (
              <div>
                <p className="m-0 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">Remboursé</p>
                <p className="m-0 mt-1 text-xl font-semibold">{money(sales.totals.refundedCents, sales.totals.currency)}</p>
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            Montants confirmés par Stripe, nets des remboursements, avant les frais Stripe.
            Un remboursement fait ici part de votre compte Stripe ; un remboursement fait
            depuis Stripe apparaît ici aussi.
          </p>
        </CardBody>
      </Card>

      {sales.purchases.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-soft)]">Aucune vente pour l&apos;instant.</p>
      ) : (
        <Card>
          <CardBody>
            <ul className="m-0 grid list-none gap-2 p-0">
              {sales.purchases.map((purchase) => (
                <li key={purchase.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="text-[var(--color-ink-soft)]">
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(purchase.createdAt))}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {purchase.email ?? 'Compte supprimé'} · {purchase.planName}
                  </span>
                  <span className="text-[var(--color-ink-soft)]">
                    {STATUS_LABEL[purchase.status] ?? purchase.status}
                    {purchase.refundedCents > 0 && purchase.status !== 'refunded'
                      ? ` · ${money(purchase.refundedCents, purchase.currency)} remboursés`
                      : ''}
                  </span>
                  <span className="tabular-nums font-medium">{money(purchase.amountCents, purchase.currency)}</span>
                  {purchase.refundable ? (
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => void refund(purchase)}
                    >
                      {busy === purchase.id ? 'Remboursement…' : 'Rembourser'}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
