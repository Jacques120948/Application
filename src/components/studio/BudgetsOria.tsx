'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Les budgets mensuels déclarés, poste par poste.
 *
 * Déclarer n'engage rien : ce formulaire ne touche à aucune campagne. Il dit à Oria ce que
 * vous comptez dépenser, pour qu'elle compare à ce qui est dépensé et à ce que cela
 * rapporte.
 */

const POSTES = [
  { id: 'google', label: 'Google Ads' },
  { id: 'meta', label: 'Meta Ads' },
  { id: 'contenu', label: 'Contenu' },
  { id: 'autres', label: 'Autres' },
] as const

export function BudgetsOria({
  siteId,
  initiaux,
  devise,
}: {
  siteId: string
  initiaux: Partial<Record<string, number>>
  devise: string
}) {
  const router = useRouter()
  const [valeurs, setValeurs] = useState<Record<string, string>>(
    Object.fromEntries(POSTES.map((poste) => [poste.id, initiaux[poste.id] === undefined ? '' : String(initiaux[poste.id])])),
  )
  const [occupe, setOccupe] = useState(false)
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | null>(null)

  async function enregistrer() {
    setOccupe(true)
    setMessage(null)
    const budgets: Record<string, number> = {}
    for (const poste of POSTES) {
      const brut = (valeurs[poste.id] ?? '').replace(/[\s']/gu, '').replace(',', '.')
      if (brut === '') continue
      const nombre = Number(brut)
      if (!Number.isFinite(nombre) || nombre < 0) {
        setOccupe(false)
        setMessage({ ton: 'erreur', texte: `« ${poste.label} » : un montant positif, sans lettre.` })
        return
      }
      budgets[poste.id] = nombre
    }
    const reponse = await fetch('/api/oria/budget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteId, budgets }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(false)
    if (reponse === null || !reponse.ok) {
      setMessage({ ton: 'erreur', texte: corps?.message ?? `L’enregistrement n’a pas abouti (code ${reponse?.status ?? 0}).` })
      return
    }
    setMessage({ ton: 'ok', texte: 'Enregistré.' })
    router.refresh()
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <h2 className="m-0 text-base font-semibold">Mon budget mensuel</h2>
      <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Ce que vous comptez dépenser chaque mois, poste par poste. Rien n’est modifié sur vos
        campagnes : Oria s’en sert pour comparer.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {POSTES.map((poste) => (
          <label key={poste.id} className="grid gap-1 text-sm">
            <span className="font-medium">{poste.label}</span>
            <span className="flex items-center gap-2">
              <input
                inputMode="decimal"
                value={valeurs[poste.id] ?? ''}
                onChange={(evenement) => {
                  setValeurs({ ...valeurs, [poste.id]: evenement.target.value })
                  setMessage(null)
                }}
                placeholder="—"
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
              <span className="shrink-0 text-xs text-[var(--color-ink-soft)]">{devise} / mois</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={enregistrer}
          disabled={occupe}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium text-white [background-image:var(--gradient-cta)] disabled:opacity-50"
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {message === null ? null : (
          <p
            role={message.ton === 'erreur' ? 'alert' : 'status'}
            className="m-0 text-sm"
            style={{ color: message.ton === 'erreur' ? 'var(--color-critical)' : 'var(--color-positive)' }}
          >
            {message.texte}
          </p>
        )}
      </div>
    </section>
  )
}
