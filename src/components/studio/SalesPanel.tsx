'use client'

import { useEffect, useState } from 'react'
import { Card, CardBody, LinkButton, Notice } from '@/components/ui'
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
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            Montants confirmés par Stripe, avant ses frais. Les remboursements se font depuis
            votre tableau de bord Stripe.
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
                  </span>
                  <span className="tabular-nums font-medium">{money(purchase.amountCents, purchase.currency)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
