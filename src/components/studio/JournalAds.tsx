'use client'

import { useState } from 'react'

/**
 * Le journal des modifications, et la condition du retour arrière.
 *
 * Il n'est pas là pour la transparence au sens décoratif. Chaque ligne conserve la valeur
 * d'avant, écrite en base **avant** que la modification ne parte chez Google : c'est ce qui
 * fait la différence entre un bouton « revenir à 15,00 CHF » qui y revient vraiment et un
 * bouton qui l'affiche. Si la valeur d'avant n'avait pas été gardée au moment où on la
 * connaissait encore, elle serait perdue.
 *
 * Les refus y figurent aussi. Un journal qui ne garderait que ce qui a réussi laisserait
 * croire que rien n'a été tenté les jours où Google a dit non — et c'est précisément ce
 * qu'on veut pouvoir relire.
 */

export type ActionVue = {
  id: string
  quoi: string
  motif: string
  mode: string
  resultat: string
  detail: string
  campagne: string | null
  quand: string
  annulee: boolean
  restauration: boolean
}

const QUOI: Record<string, string> = {
  budget: 'Budget quotidien',
  pause: 'Mise en pause',
  reprise: 'Remise en diffusion',
  titre: 'Titre d’annonce',
  description: 'Description d’annonce',
}

const RESULTATS: Record<string, { mot: string; couleur: string }> = {
  reussi: { mot: 'Envoyé', couleur: 'var(--color-positive)' },
  refuse: { mot: 'Refusé par Google', couleur: 'var(--color-critical)' },
  prevu: { mot: 'Issue inconnue', couleur: 'var(--color-caution)' },
}

export function JournalAds({ initiales }: { initiales: readonly ActionVue[] }) {
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function revenir(id: string) {
    setOccupe(id)
    setErreur(null)
    const reponse = await fetch('/api/ads/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'restaurer', actionId: id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as
      | { ok?: boolean; raison?: string; message?: string }
      | null
    setOccupe(null)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `Le retour n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    if (corps?.ok !== true) {
      setErreur(corps?.raison ?? 'Google n’a pas accepté le retour en arrière.')
      return
    }
    window.location.reload()
  }

  if (initiales.length === 0) {
    return (
      <details id="journal" className="scroll-mt-6">
        <summary className="cursor-pointer text-base font-semibold">
          Journal des modifications
        </summary>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Aucune modification n’a été envoyée à Google depuis Evoliia. Cette liste gardera la
          trace de chacune, avec sa valeur d’avant, pour que le retour en arrière soit
          toujours possible.
        </p>
      </details>
    )
  }

  return (
    <details id="journal" open className="scroll-mt-6">
      <summary className="cursor-pointer text-base font-semibold">
        Journal des modifications ({initiales.length})
      </summary>

      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {initiales.map((une) => {
          const issue = RESULTATS[une.resultat] ?? RESULTATS.prevu
          const reversible = une.resultat === 'reussi' && !une.annulee && !une.restauration
          return (
            <li
              key={une.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 text-sm">
                  <span className="font-medium">{QUOI[une.quoi] ?? une.quoi}</span>
                  {une.campagne === null ? '' : ` — ${une.campagne}`}
                </p>
                <span className="text-xs" style={{ color: issue?.couleur }}>
                  {issue?.mot}
                </span>
              </div>

              <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
                {une.motif}
                {une.restauration ? ' · retour en arrière' : ''}
                {une.annulee ? ' · annulée depuis' : ''}
                {' · '}
                {une.quand}
              </p>

              {une.resultat === 'refuse' && une.detail !== '' ? (
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">{une.detail}</p>
              ) : null}

              {une.resultat === 'prevu' ? (
                <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-caution)]">
                  L’envoi a été interrompu : cette modification a pu partir malgré tout.
                  Vérifiez dans Google Ads, ou attendez la prochaine lecture de vos campagnes.
                </p>
              ) : null}

              {reversible ? (
                <button
                  type="button"
                  onClick={() => void revenir(une.id)}
                  disabled={occupe !== null}
                  className="mt-2 cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {occupe === une.id ? 'Retour…' : 'Revenir en arrière'}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>

      {erreur === null ? null : (
        <p role="alert" className="mt-2 mb-0 text-sm text-[var(--color-critical)]">
          {erreur}
        </p>
      )}
    </details>
  )
}
