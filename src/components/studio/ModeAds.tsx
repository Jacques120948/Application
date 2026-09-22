'use client'

import { useState } from 'react'

/**
 * Ce que Naya a le droit de faire sur ce compte.
 *
 * Le réglage existe parce que Google n'en offre pas. La portée `adwords` donne la lecture et
 * l'écriture d'un seul coup : quelqu'un qui relie son compte pour voir ses chiffres a, du
 * point de vue de Google, autorisé qu'on modifie ses campagnes. Ce commutateur est le seul
 * endroit où cette distinction existe, et il part du bon côté — lecture seule, y compris
 * pour les comptes reliés avant qu'il n'existe.
 *
 * Il n'y a que deux positions. « Autopilote » n'en est pas une troisième restée grisée :
 * rien dans Evoliia ne sait agir sans qu'une personne clique, et afficher un mode
 * indisponible ferait croire à une fonction qui existe.
 */

export function ModeAds({
  initial,
  ouvert,
  /*
   * Le compte concerné. Sans lui, le commutateur de l'écran de MIRA changeait le mode du
   * compte Google : on croyait avoir ouvert l'écriture chez Meta, et il ne s'y passait rien.
   */
  plateforme = 'google-ads',
  agent = 'Naya',
  chez = 'Google',
}: {
  initial: string
  ouvert: boolean
  plateforme?: 'google-ads' | 'meta-ads'
  /** Le nom de l'agent concerné, pour que la phrase parle de qui agit. */
  agent?: string
  /** La plateforme, telle qu'on la nomme à l'écran. */
  chez?: string
}) {
  const [mode, setMode] = useState(initial)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function changer(vers: string) {
    setOccupe(true)
    setErreur(null)
    const reponse = await fetch('/api/ads/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: vers, plateforme }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(false)
    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `Le changement n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    setMode(vers)
    // La page est rendue côté serveur : les boutons d'action dépendent du mode.
    window.location.reload()
  }

  const assiste = mode === 'assiste'

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-medium">
            {assiste ? 'Mode assisté' : 'Lecture seule'}
          </p>
          <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
            {assiste
              ? `${agent} peut vous proposer d’appliquer une modification. Chacune demande votre confirmation, conserve sa valeur d’avant, et peut être annulée.`
              : `Evoliia lit vos campagnes et ne modifie rien. Aucune écriture n’est envoyée à ${chez}.`}
          </p>
        </div>

        {!ouvert ? (
          <span className="text-xs text-[var(--color-ink-faint)]">
            Le mode assisté n’est pas ouvert sur cette installation.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void changer(assiste ? 'lecture' : 'assiste')}
            disabled={occupe}
            className="shrink-0 cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
          >
            {occupe
              ? 'Un instant…'
              : assiste
                ? 'Repasser en lecture seule'
                : 'Activer le mode assisté'}
          </button>
        )}
      </div>

      {erreur === null ? null : (
        <p role="alert" className="mt-2 mb-0 text-sm text-[var(--color-critical)]">
          {erreur}
        </p>
      )}
    </div>
  )
}
