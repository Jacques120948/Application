'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardBody, Notice } from '@/components/ui'
import {
  ANGLE_FAMILY_LABEL,
  DAY_LABEL,
  FORMAT_LABEL,
  INTENT_LABEL,
  NETWORK_LABEL,
  NETWORKS,
  OBJECTIVE_LABEL,
  VARIATION_INTENTS,
  type MonthlyPlan,
  type Variation,
  type VariationIntent,
} from '@/lib/marketing'

/**
 * L'atelier du kit : retravailler une publication, prolonger la semaine en mois.
 *
 * Deux partis pris qui se répondent.
 *
 * **Les versions proposées ne remplacent rien d'elles-mêmes.** Elles s'affichent à côté du
 * texte actuel, et c'est un geste explicite qui en retient une. Remplacer d'office ferait
 * perdre un texte que le créateur avait peut-être déjà corrigé à la main.
 *
 * **Le coût est sur le bouton, avant le clic.** Chaque opération appelle un modèle et se
 * paie ; le découvrir après coup, en regardant son solde, est la meilleure façon de ne plus
 * oser s'en servir.
 */

const TONES = ['chaleureux', 'direct', 'professionnel', 'complice', 'sobre'] as const

export function PostVariations({
  index,
  kitId,
  projectId,
  credits,
  estimatedCredits,
  onApply,
}: {
  index: number
  kitId: string
  projectId: string
  credits: number
  estimatedCredits: number
  /** Appelé quand le créateur retient une version. Le parent enregistre le kit. */
  onApply: (variation: Variation) => void
}) {
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState<VariationIntent>('REWRITE')
  const [tone, setTone] = useState<string>(TONES[0])
  const [network, setNetwork] = useState<string>(NETWORKS[0])
  const [variations, setVariations] = useState<Variation[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assez = credits >= estimatedCredits

  async function demander() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/marketing/atelier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'variations',
        kitId,
        index,
        intent,
        ...(intent === 'TONE' ? { tone } : {}),
        ...(intent === 'NETWORK' ? { network } : {}),
      }),
    })
    const body = (await response.json()) as { message?: string; variations?: Variation[] }
    setBusy(false)
    if (!response.ok || body.variations === undefined) {
      setError(body.message ?? "Les versions n'ont pas pu être préparées.")
      return
    }
    setVariations(body.variations)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="justify-self-start text-sm font-medium text-[var(--color-brand-strong)]"
      >
        Retravailler ce texte
      </button>
    )
  }

  return (
    <div className="grid gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
      <div className="flex flex-wrap gap-2">
        {VARIATION_INTENTS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setIntent(candidate)}
            className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-sm transition ${
              candidate === intent
                ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]'
                : 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-soft)]'
            }`}
          >
            {INTENT_LABEL[candidate]}
          </button>
        ))}
      </div>

      {intent === 'TONE' ? (
        <label className="grid gap-1 text-sm">
          <span className="text-[var(--color-ink-soft)]">Ton visé</span>
          <select
            value={tone}
            onChange={(event) => setTone(event.target.value)}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
          >
            {TONES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {intent === 'NETWORK' ? (
        <label className="grid gap-1 text-sm">
          <span className="text-[var(--color-ink-soft)]">Réseau visé</span>
          <select
            value={network}
            onChange={(event) => setNetwork(event.target.value)}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
          >
            {NETWORKS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {NETWORK_LABEL[candidate]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error === null ? null : <Notice tone="critical">{error}</Notice>}
      {assez ? null : (
        <Notice tone="caution">
          Il vous reste {credits} crédits. Cette opération en coûte environ {estimatedCredits}.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={demander} disabled={busy || !assez}>
          {busy ? 'Un instant…' : `Proposer des versions · ${estimatedCredits} crédits`}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>

      {variations === null
        ? null
        : variations.map((variation, rang) => (
            <div
              key={`${variation.label}-${rang}`}
              className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
            >
              <Badge tone="brand">{variation.label}</Badge>
              <p className="m-0 whitespace-pre-line text-sm leading-relaxed">
                {variation.caption}
              </p>
              {variation.cta === '' ? null : (
                <p className="m-0 text-sm text-[var(--color-ink-soft)]">{variation.cta}</p>
              )}
              {variation.hashtags.length === 0 ? null : (
                <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                  {variation.hashtags.map((tag) => `#${tag}`).join(' ')}
                </p>
              )}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    onApply(variation)
                    setVariations(null)
                    setOpen(false)
                  }}
                >
                  Garder cette version
                </Button>
              </div>
            </div>
          ))}

      <p className="m-0 text-xs text-[var(--color-ink-faint)]">
        Le texte actuel reste en place tant que vous n’en retenez pas une.
      </p>
    </div>
  )
}

export function MonthBoard({
  kitId,
  projectId,
  initialPlan,
  credits,
  estimatedCredits,
  approved,
}: {
  kitId: string
  projectId: string
  initialPlan: MonthlyPlan | null
  credits: number
  estimatedCredits: number
  /** Le mois se bâtit sur une semaine relue : sans approbation, on préparerait à côté. */
  approved: boolean
}) {
  const [plan, setPlan] = useState(initialPlan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assez = credits >= estimatedCredits

  async function preparer() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/marketing/atelier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mois', kitId }),
    })
    const body = (await response.json()) as { message?: string; plan?: MonthlyPlan }
    setBusy(false)
    if (!response.ok || body.plan === undefined) {
      setError(body.message ?? "Le mois n'a pas pu être préparé.")
      return
    }
    setPlan(body.plan)
  }

  const semaines = plan === null ? [] : [...new Set(plan.posts.map((post) => post.week))].sort()

  return (
    <section className="grid gap-3">
      <div>
        <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
          Le mois complet
        </h2>
        <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">
          Quatre semaines qui progressent, à partir des angles que vous avez retenus : se
          faire connaître, prouver, lever les objections, inviter.
        </p>
      </div>

      {error === null ? null : <Notice tone="critical">{error}</Notice>}
      {approved ? null : (
        <Notice tone="neutral">
          Relisez et approuvez votre semaine d’abord. Le mois la prolonge : la préparer avant
          reviendrait à écrire quatre fois un texte que vous allez peut-être corriger.
        </Notice>
      )}
      {assez || plan !== null ? null : (
        <Notice tone="caution">
          Il vous reste {credits} crédits. Le mois en coûte environ {estimatedCredits}.
        </Notice>
      )}

      <div>
        <Button type="button" onClick={preparer} disabled={busy || !assez || !approved}>
          {busy
            ? 'Préparation en cours…'
            : plan === null
              ? `Préparer mon mois · ${estimatedCredits} crédits`
              : `Préparer un nouveau mois · ${estimatedCredits} crédits`}
        </Button>
      </div>

      {plan === null ? null : (
        <div className="grid gap-4">
          <p className="m-0 rounded-[var(--radius-control)] border border-[var(--color-brand)] bg-[var(--color-brand-soft)] p-4 text-sm">
            <span className="font-medium">Le fil du mois : </span>
            {plan.theme}
          </p>
          {semaines.map((semaine) => (
            <div key={semaine} className="grid gap-2">
              <h3 className="m-0 text-sm font-semibold">Semaine {semaine}</h3>
              {plan.posts
                .filter((post) => post.week === semaine)
                .map((post, rang) => (
                  <Card key={`${semaine}-${post.day}-${post.time}-${rang}`}>
                    <CardBody className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {DAY_LABEL[post.day] ?? 'Jour'} à {post.time}
                        </span>
                        <Badge tone="brand">{ANGLE_FAMILY_LABEL[post.angleKey]}</Badge>
                        <Badge tone="neutral">{OBJECTIVE_LABEL[post.objective]}</Badge>
                        <Badge tone="neutral">{FORMAT_LABEL[post.format]}</Badge>
                      </div>
                      <p className="m-0 whitespace-pre-line text-sm leading-relaxed">
                        {post.caption}
                      </p>
                      {post.cta === '' ? null : (
                        <p className="m-0 text-sm text-[var(--color-ink-soft)]">{post.cta}</p>
                      )}
                      {post.hashtags.length === 0 ? null : (
                        <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                          {post.hashtags.map((tag) => `#${tag}`).join(' ')}
                        </p>
                      )}
                    </CardBody>
                  </Card>
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
