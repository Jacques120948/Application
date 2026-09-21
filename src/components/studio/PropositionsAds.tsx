'use client'

import { useState } from 'react'

/**
 * Ce que Naya propose d'ajouter à une annonce.
 *
 * Montré à côté de ce qui existe, jamais mêlé. Ranger une proposition parmi les titres
 * réels ferait compter « 12 sur 15 » à une annonce qui n'en a que neuf : la personne
 * croirait son travail fait, et Google continuerait de lui donner moins de place.
 *
 * Trois partis pris.
 *
 * **Chaque proposition porte son motif.** « Reprend la recherche "bougie quartz rose" » se
 * vérifie et se conteste ; un titre seul se subit. C'est la même règle que pour les
 * recommandations de budget, et pour la même raison.
 *
 * **La longueur est affichée.** Trente caractères, c'est court, et ça ne se voit pas à
 * l'œil. Le compteur dit ce qui reste de place — et permet de juger un texte qui s'arrête à
 * dix-huit alors qu'il pouvait en dire plus.
 *
 * **Rien n'est déposé ici.** Ces textes vivent chez Evoliia. Les envoyer chez Google est un
 * geste distinct, qui aura sa confirmation et son journal.
 */

export type PropositionVue = {
  id: string
  champ: string
  texte: string
  motif: string
  longueur: number
  maximum: number
}

const CHAMPS: Record<string, string> = {
  titre: 'Titre',
  'titre-long': 'Titre long',
  description: 'Description',
}

export function PropositionsAds({
  groupeId,
  initiales,
  complet,
}: {
  groupeId: string
  initiales: readonly PropositionVue[]
  /** Vrai quand le contenant est plein, propositions en attente comprises. */
  complet: boolean
}) {
  const [liste, setListe] = useState<PropositionVue[]>([...initiales])
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function rediger() {
    setOccupe('rediger')
    setErreur(null)
    setMessage(null)
    const reponse = await fetch('/api/ads/propositions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'rediger', groupeId }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as {
      ok?: boolean
      message?: string
      bilan?: { proposees: number; rejetees: number; credits: number }
    } | null
    setOccupe(null)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `La rédaction n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    const bilan = corps?.bilan
    setMessage(
      bilan === undefined
        ? 'Rédaction terminée. Rechargez la page.'
        : `${bilan.proposees} proposition${bilan.proposees > 1 ? 's' : ''}${
            bilan.rejetees === 0
              ? ''
              : `, ${bilan.rejetees} écartée${bilan.rejetees > 1 ? 's' : ''} pour longueur ou doublon`
          }. ${bilan.credits} crédit${bilan.credits > 1 ? 's' : ''}. Rechargez la page.`,
    )
    window.location.reload()
  }

  async function ecarter(id: string) {
    setOccupe(id)
    setErreur(null)
    const reponse = await fetch('/api/ads/propositions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ecarter', id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(null)
    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `Le geste n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    setListe((actuelles) => actuelles.filter((une) => une.id !== id))
  }

  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
          Propositions de Naya{liste.length === 0 ? '' : ` — ${liste.length}`}
        </p>
        <button
          type="button"
          onClick={() => void rediger()}
          disabled={occupe !== null || complet}
          className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:border-[var(--color-line)] disabled:text-[var(--color-ink-faint)]"
        >
          {occupe === 'rediger'
            ? 'Naya écrit…'
            : complet
              ? 'Rien à compléter'
              : liste.length === 0
                ? 'Demander des textes'
                : 'En demander d’autres'}
        </button>
      </div>

      {liste.length === 0 ? (
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {complet
            ? 'Ce contenant est plein. Déposez ou écartez des propositions avant d’en demander d’autres.'
            : 'Naya peut écrire ce qui manque, à partir de ce que les gens tapent réellement et de ce que vend votre boutique. Elle ne répétera pas les textes déjà en place.'}
        </p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {liste.map((une) => (
            <li
              key={une.id}
              className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{une.texte}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                  {CHAMPS[une.champ] ?? une.champ} · {une.longueur}/{une.maximum}
                </span>
              </div>
              {une.motif === '' ? null : (
                <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                  {une.motif}
                </p>
              )}
              <button
                type="button"
                onClick={() => void ecarter(une.id)}
                disabled={occupe !== null}
                className="mt-2 cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1 text-xs text-[var(--color-ink-soft)] disabled:opacity-50"
              >
                {occupe === une.id ? 'Un instant…' : 'Écarter'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {message === null ? null : (
        <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">{message}</p>
      )}
      {erreur === null ? null : (
        <p role="alert" className="mt-2 mb-0 text-sm text-[var(--color-critical)]">
          {erreur}
        </p>
      )}

      <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Ces textes ne sont pas encore chez Google : ils vivent chez Evoliia jusqu’à ce que
        vous décidiez de les déposer. Les longueurs sont vérifiées avant affichage — un titre
        de trente et un caractères est refusé par Google sans explication utile.
      </p>
    </div>
  )
}
