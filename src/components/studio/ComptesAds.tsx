'use client'

import { useState } from 'react'

/**
 * Le choix du compte publicitaire que Naya suit.
 *
 * Un seul à la fois, et l'écran doit dire pourquoi. Additionner deux comptes donnerait un
 * ROAS moyen qui ne décrit aucune réalité, et proposer un budget sur une moyenne est la
 * meilleure façon de se tromper deux fois.
 *
 * Les comptes administrateurs sont montrés mais non choisissables : les cacher ferait
 * chercher un compte qu'on sait posséder, et les rendre choisissables donnerait un tableau
 * de bord vide sans que rien n'explique pourquoi.
 */

export type CompteVu = {
  id: string
  compteId: string
  nom: string
  devise: string
  fuseau: string
  gestionnaire: boolean
  actif: boolean
  /** Le détail a pu être lu chez Google. Faux : le compte existe mais reste opaque. */
  lisible: boolean
}

/** Le numéro de compte tel que Google l'écrit, par groupes de trois chiffres. */
function enClair(compteId: string): string {
  const chiffres = compteId.replace(/\D/gu, '')
  if (chiffres.length !== 10) return compteId
  return `${chiffres.slice(0, 3)}-${chiffres.slice(3, 6)}-${chiffres.slice(6)}`
}

export function ComptesAds({ initiaux }: { initiaux: readonly CompteVu[] }) {
  const [comptes, setComptes] = useState<CompteVu[]>([...initiaux])
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function choisir(id: string) {
    setOccupe(id)
    setErreur(null)
    const reponse = await fetch('/api/ads/compte', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ compteId: id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(null)
    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `Le changement n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    setComptes((actuels) => actuels.map((compte) => ({ ...compte, actif: compte.id === id })))
  }

  const diffusants = comptes.filter((compte) => !compte.gestionnaire && compte.lisible)

  return (
    <div className="grid gap-3">
      {comptes.map((compte) => (
        <div
          key={compte.id}
          className={`rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-4 ${
            compte.actif ? 'border-[var(--color-brand)]' : 'border-[var(--color-line)]'
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="m-0 text-sm font-medium">{compte.nom}</p>
            {compte.actif ? (
              <span className="rounded-[var(--radius-pill)] bg-[var(--color-brand-soft)] px-2 py-0.5 text-xs text-[var(--color-brand-strong)]">
                Suivi par Naya
              </span>
            ) : null}
          </div>
          <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">
            {enClair(compte.compteId)}
            {compte.devise === '' ? '' : ` · ${compte.devise}`}
            {compte.fuseau === '' ? '' : ` · ${compte.fuseau}`}
          </p>

          {!compte.lisible ? (
            /*
             * Montré plutôt que caché : le cacher ferait chercher un compte qu'on sait
             * posséder. Mais pas choisissable — le suivre donnerait un écran vide.
             */
            <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              Evoliia n’a pas pu lire ce compte chez Google : il est peut-être fermé,
              suspendu, ou votre compte Google n’y a plus accès. Il ne peut pas être suivi.
            </p>
          ) : compte.gestionnaire ? (
            <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              Compte administrateur : il gère d’autres comptes et ne diffuse pas de publicité
              lui-même. Il n’a donc ni dépense ni conversion à montrer.
            </p>
          ) : compte.actif ? null : (
            <button
              type="button"
              onClick={() => void choisir(compte.id)}
              disabled={occupe !== null}
              className="mt-2 cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
            >
              {occupe === compte.id ? 'Changement…' : 'Suivre ce compte'}
            </button>
          )}
        </div>
      ))}

      {diffusants.length > 1 ? (
        <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Naya ne suit qu’un compte à la fois. Additionner deux comptes donnerait un ROAS
          moyen qui ne décrit aucune réalité — et un budget proposé sur une moyenne se trompe
          deux fois.
        </p>
      ) : null}

      {erreur === null ? null : (
        <p className="m-0 text-sm text-[var(--color-danger,#b42318)]">{erreur}</p>
      )}
    </div>
  )
}
