'use client'

import { useState } from 'react'

/**
 * Ce que MIRA a modifié chez Meta, et comment le défaire.
 *
 * Le journal est la contrepartie du droit d'écrire. Un produit qui modifie la dépense de
 * quelqu'un doit pouvoir répondre à trois questions sans qu'on ait à le lui demander : qu'a-
 * t-il changé, pourquoi, et comment revenir en arrière. Sans la troisième, les deux
 * premières ne sont qu'un aveu.
 *
 * Trois partis pris.
 *
 * **Le refus se garde autant que la réussite.** Une modification que Meta a refusée reste
 * au journal, avec ce que Meta a répondu. L'effacer ferait chercher pourquoi rien n'a
 * changé, alors que la réponse est écrite.
 *
 * **Le retour arrière est lui-même journalisé.** Il apparaît comme une ligne de plus, pas
 * comme une disparition : « on a mis en pause, puis on a relancé » raconte quelque chose que
 * « rien ne s'est passé » efface.
 *
 * **Ce qui est déjà défait ne se redéfait pas.** Le bouton disparaît, et la ligne le dit.
 */

export type ActionVue = {
  id: string
  quoi: string
  motif: string
  resume: string
  resultat: string
  detail: string
  createdAt: string
  annulee: boolean
  restaurable: boolean
}

type Ton = { mot: string; couleur: string }

/*
 * « Issue inconnue » plutôt que « en cours » : une ligne restée à « prévu » est une écriture
 * coupée en plein vol, dont on ne sait pas si elle est partie. Le dire est plus utile que de
 * laisser croire à une attente qui finira.
 */
const INCONNU: Ton = { mot: 'Issue inconnue', couleur: 'var(--color-caution)' }

const RESULTATS: Record<string, Ton> = {
  reussi: { mot: 'Envoyé', couleur: 'var(--color-positive)' },
  refuse: { mot: 'Refusé par Meta', couleur: 'var(--color-critical)' },
  prevu: INCONNU,
}

export function JournalMeta({ initiales }: { initiales: readonly ActionVue[] }) {
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function restaurer(id: string) {
    setOccupe(id)
    setErreur(null)
    const reponse = await fetch('/api/ads/meta/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geste: 'restaurer', actionId: id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as
      | { ok?: boolean; raison?: string; message?: string }
      | null
    setOccupe(null)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `Le retour arrière n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    if (corps?.ok !== true) {
      setErreur(corps?.raison ?? 'Meta n’a pas accepté le retour arrière.')
      return
    }
    // La page est rendue côté serveur : statuts, budgets et journal ont tous changé.
    window.location.reload()
  }

  if (initiales.length === 0) return null

  return (
    <details className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <summary className="cursor-pointer list-none">
        <span className="text-base font-semibold">Ce que MIRA a modifié</span>
        <span className="ml-2 text-sm text-[var(--color-ink-soft)]">
          {initiales.length} modification{initiales.length > 1 ? 's' : ''}
        </span>
      </summary>

      {erreur === null ? null : (
        <p
          role="alert"
          className="mt-3 mb-0 rounded-[var(--radius-control)] bg-[var(--color-critical-soft)] p-3 text-sm text-[var(--color-critical)]"
        >
          {erreur}
        </p>
      )}

      <ul className="mt-4 mb-0 grid list-none gap-3 p-0">
        {initiales.map((action) => {
          const ton = RESULTATS[action.resultat] ?? INCONNU
          return (
            <li
              key={action.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 text-sm font-medium break-words">{action.resume}</p>
                <span className="text-xs" style={{ color: ton.couleur }}>
                  {ton.mot}
                </span>
              </div>
              <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">
                {new Date(action.createdAt).toLocaleString('fr-CH')} · {action.motif}
                {action.annulee ? ' · déjà défaite' : ''}
              </p>
              {action.detail === '' ? null : (
                <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                  Meta a répondu : {action.detail}
                </p>
              )}
              {!action.restaurable ? null : (
                <button
                  type="button"
                  onClick={() => void restaurer(action.id)}
                  disabled={occupe === action.id}
                  className="mt-3 cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-ink-soft)] disabled:opacity-50"
                >
                  {occupe === action.id ? 'Un instant…' : 'Remettre comme avant'}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <p className="mt-4 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Chaque ligne conserve la valeur d’avant : c’est elle qui est renvoyée chez Meta quand
        vous remettez comme avant. Les refus restent affichés avec la réponse de Meta — les
        effacer ferait chercher pourquoi rien n’a changé.
      </p>
    </details>
  )
}
