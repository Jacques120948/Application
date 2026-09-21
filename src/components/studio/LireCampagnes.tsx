'use client'

import { useState } from 'react'

/**
 * Lire les campagnes maintenant.
 *
 * Le bouton existe pour une raison simple : la lecture a lieu la nuit, et quelqu'un qui
 * vient de relier son compte n'a aucune envie d'attendre jusqu'au lendemain pour savoir si
 * ça marche. Il ne remplace pas la tournée nocturne, il l'anticipe.
 */
export function LireCampagnes({ premiere }: { premiere: boolean }) {
  const [occupe, setOccupe] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function lire() {
    setOccupe(true)
    setMessage(null)
    const reponse = await fetch('/api/ads/synchro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as {
      ok?: boolean
      raison?: string
      message?: string
      bilan?: { campagnes: number; journees: number }
    } | null
    setOccupe(false)

    if (reponse === null || !reponse.ok) {
      setMessage(corps?.message ?? `La lecture n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    if (corps?.ok === false) {
      setMessage(corps.raison ?? 'La lecture n’a pas abouti.')
      return
    }
    const bilan = corps?.bilan
    setMessage(
      bilan === undefined
        ? 'Lecture terminée. Rechargez la page.'
        : `${bilan.campagnes} campagne${bilan.campagnes > 1 ? 's' : ''} et ${bilan.journees} journée${bilan.journees > 1 ? 's' : ''} lues. Rechargez la page pour voir les chiffres.`,
    )
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => void lire()}
        disabled={occupe}
        className="justify-self-start cursor-pointer rounded-[var(--radius-pill)] border-0 bg-[var(--color-brand)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {occupe ? 'Naya lit vos campagnes…' : 'Lire mes campagnes maintenant'}
      </button>
      <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        {premiere
          ? 'La première lecture remonte quatre-vingt-dix jours pour qu’il y ait de quoi comparer dès le premier écran. Comptez jusqu’à une minute.'
          : 'Deux lectures chez Google, sans frais et sans crédit. La lecture a lieu de toute façon chaque nuit.'}
      </p>
      {message === null ? null : (
        <p className="m-0 text-sm text-[var(--color-ink-soft)]">{message}</p>
      )}
    </div>
  )
}
