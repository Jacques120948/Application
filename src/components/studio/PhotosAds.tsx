'use client'

import { useState } from 'react'

/**
 * Les photos de la boutique, proposées pour un groupe d'éléments.
 *
 * Naya ne fabrique pas d'image, et ce n'est pas une limite technique. Une bougie produite
 * par une intelligence artificielle montrerait dans l'annonce un produit qui n'existe pas
 * dans la boutique : quelqu'un cliquerait sur une bougie qu'il ne trouverait nulle part.
 * Ce qui est montré ici est ce qui est vendu.
 *
 * Trois partis pris.
 *
 * **Le motif du rapprochement est affiché.** « citrine, bougie » dit pourquoi cette fiche
 * plutôt qu'une autre, et permet de contester le choix. Une vignette seule se subit.
 *
 * **Le recadrage est annoncé avant le clic.** Google impose trois proportions exactes ; une
 * photo carrée ne devient pas un paysage sans perdre le haut et le bas. Le découvrir sur
 * l'annonce serait la mauvaise façon de l'apprendre.
 *
 * **Une photo par format, pas un lot.** Déposer les trois d'un coup irait plus vite et
 * enverrait deux recadrages qu'on n'a pas regardés.
 */

export type PhotoVue = {
  handle: string
  titre: string
  image: string
  alt: string
  motifs: string[]
}

export type FormatVu = { cle: string; nom: string; coupe: string; dimensions: string }

export function PhotosAds({
  groupeId,
  photos,
  formats,
  deposable,
}: {
  groupeId: string
  photos: readonly PhotoVue[]
  formats: readonly FormatVu[]
  /** Vrai quand le compte est en mode assisté : sans cela, aucun dépôt n'est possible. */
  deposable: boolean
}) {
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [choisie, setChoisie] = useState<string | null>(null)

  async function deposer(handle: string, format: string) {
    setOccupe(`${handle}:${format}`)
    setErreur(null)
    const reponse = await fetch('/api/ads/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'photo', groupeId, handle, format }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as
      | { ok?: boolean; raison?: string; message?: string }
      | null
    setOccupe(null)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `L’envoi n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    if (corps?.ok !== true) {
      setErreur(corps?.raison ?? 'Google n’a pas accepté cette image.')
      setChoisie(null)
      return
    }
    window.location.reload()
  }

  if (photos.length === 0) return null

  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-4">
      <p className="m-0 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
        Photos de votre boutique — {photos.length}
      </p>

      <ul className="m-0 grid list-none gap-3 p-0">
        {photos.map((photo) => (
          <li key={photo.handle} className="flex flex-wrap items-start gap-3">
            {/*
              Servie par Shopify, telle quelle : elle ne passe pas par l'optimiseur du cadre,
              qui refuserait un domaine qu'il ne connaît pas.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.image}
              alt={photo.alt}
              loading="lazy"
              className="h-20 w-20 shrink-0 rounded-[var(--radius-control)] border border-[var(--color-line)] object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-medium">{photo.titre}</p>
              {photo.motifs.length === 0 ? null : (
                <p className="mt-0.5 mb-0 text-xs text-[var(--color-ink-soft)]">
                  Rapprochée par : {photo.motifs.join(', ')}
                </p>
              )}

              {!deposable ? null : choisie === photo.handle ? (
                <div className="mt-2 grid gap-2">
                  {formats.map((format) => (
                    <button
                      key={format.cle}
                      type="button"
                      onClick={() => void deposer(photo.handle, format.cle)}
                      disabled={occupe !== null}
                      className="cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-3 py-2 text-left text-xs disabled:opacity-50"
                    >
                      <span className="font-medium">
                        {occupe === `${photo.handle}:${format.cle}`
                          ? 'Envoi…'
                          : `${format.nom} · ${format.dimensions}`}
                      </span>
                      <span className="mt-0.5 block text-[var(--color-ink-soft)]">
                        {format.coupe}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setChoisie(null)}
                    disabled={occupe !== null}
                    className="cursor-pointer justify-self-start rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1 text-xs text-[var(--color-ink-soft)] disabled:opacity-50"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setChoisie(photo.handle)}
                  disabled={occupe !== null}
                  className="mt-2 cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1 text-xs text-[var(--color-brand-strong)] disabled:opacity-50"
                >
                  Déposer cette photo…
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {erreur === null ? null : (
        <p role="alert" className="mt-2 mb-0 text-sm break-words text-[var(--color-critical)]">
          {erreur}
        </p>
      )}

      <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Naya ne fabrique pas d’image : une bougie produite par une intelligence artificielle
        montrerait dans votre annonce un produit que personne ne trouverait chez vous. Ces
        photos sont les vôtres, recadrées aux proportions que Google impose. Chaque dépôt
        reste annulable depuis le journal.
      </p>
    </div>
  )
}
