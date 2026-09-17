'use client'

import { useState } from 'react'

/**
 * Le plan d'action.
 *
 * C'est ce qui sépare un rapport d'un outil. Un audit qui rend trente constats et repart de
 * zéro le mois suivant se referme ; une liste où l'on coche ce qu'on a fait, et qui s'en
 * souvient, se rouvre. Trois partis pris.
 *
 * **Quatre états, pas une case à cocher.** « En cours » existe parce que corriger deux cents
 * descriptions prend plusieurs séances, et qu'une liste qui ne sait dire que fait ou pas
 * fait oblige à tout garder en tête. « Ignorée » existe parce qu'un constat qu'on a décidé
 * de ne pas traiter doit cesser de remonter, sans disparaître pour autant.
 *
 * **L'état part au serveur tout de suite, et l'écran ne ment pas en attendant.** Le bouton
 * s'affiche coché dès le clic — sinon on doute d'avoir cliqué — mais un refus le rend à son
 * état d'avant et le dit. Un plan qui affiche « corrigée » sur quelque chose qui n'a pas été
 * enregistré est pire que pas de plan du tout.
 *
 * **Ce qui est réglé ou ignoré descend, il ne disparaît pas.** Voir ce qu'on a traité est ce
 * qui donne envie de continuer.
 */

export type EtatAction = 'todo' | 'doing' | 'done' | 'ignored'

export type LigneVue = {
  checkId: string
  engine: string
  label: string
  why: string
  scope: string
  severity: string
  affected: number
  examined: number
  sample: { path: string; url: string; title: string }[]
  state: EtatAction
}

const ETATS: { id: EtatAction; label: string }[] = [
  { id: 'todo', label: 'À faire' },
  { id: 'doing', label: 'En cours' },
  { id: 'done', label: 'Corrigée' },
  { id: 'ignored', label: 'Ignorée' },
]

const GRAVITES: Record<string, { label: string; fond: string; texte: string }> = {
  critical: { label: 'Critique', fond: 'var(--color-critical-soft)', texte: 'var(--color-critical)' },
  important: { label: 'Important', fond: 'var(--color-accent-soft)', texte: 'var(--color-accent)' },
  improvement: {
    label: 'Amélioration',
    fond: 'var(--color-brand-soft)',
    texte: 'var(--color-brand-strong)',
  },
}

const MOTEURS: Record<string, string> = { seo: 'Référencement', geo: 'Moteurs IA' }

/** Une ligne traitée s'efface visuellement sans quitter la liste. */
const RETIREE: Record<EtatAction, boolean> = {
  todo: false,
  doing: false,
  done: true,
  ignored: true,
}

export function PlanAction({ siteId, lignes }: { siteId: string; lignes: readonly LigneVue[] }) {
  const [etats, setEtats] = useState<Record<string, EtatAction>>(
    Object.fromEntries(lignes.map((ligne) => [ligne.checkId, ligne.state])),
  )
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)

  async function changer(checkId: string, state: EtatAction) {
    const avant = etats[checkId] ?? 'todo'
    if (state === avant) return
    // On montre le résultat tout de suite : sans cela, on doute d'avoir cliqué.
    setEtats((actuels) => ({ ...actuels, [checkId]: state }))
    setErreur(null)
    setEnCours(checkId)

    const response = await fetch(`/api/sites/${siteId}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkId, state }),
    }).catch(() => null)
    setEnCours(null)

    if (response === null || !response.ok) {
      // Rendre la ligne à son état d'avant : un plan qui affiche « corrigée » sur quelque
      // chose qui n'a pas été enregistré est pire que pas de plan du tout.
      setEtats((actuels) => ({ ...actuels, [checkId]: avant }))
      setErreur('Ce changement n’a pas été enregistré. Réessayez dans un instant.')
    }
  }

  const restantes = lignes.filter((ligne) => !RETIREE[etats[ligne.checkId] ?? 'todo']).length

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <p className="m-0 text-sm text-[var(--color-ink-soft)]">
          {restantes === 0
            ? 'Tout est traité. Relancez une analyse pour vérifier.'
            : `${restantes} point${restantes > 1 ? 's' : ''} encore ouvert${restantes > 1 ? 's' : ''} sur ${lignes.length}.`}
        </p>
        {erreur === null ? null : (
          <p className="m-0 text-sm text-[var(--color-critical)]">{erreur}</p>
        )}
      </div>

      <ol className="m-0 grid list-none gap-3 p-0">
        {lignes.map((ligne, rang) => {
          const etat = etats[ligne.checkId] ?? 'todo'
          const traitee = RETIREE[etat]
          const gravite = GRAVITES[ligne.severity] ?? GRAVITES['improvement']
          return (
            <li
              key={ligne.checkId}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 transition-opacity"
              style={{ opacity: traitee ? 0.55 : 1 }}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-sm font-semibold text-[var(--color-ink-faint)]">
                  {rang + 1}.
                </span>
                <h3
                  className="m-0 text-base font-semibold"
                  style={{ textDecoration: etat === 'ignored' ? 'line-through' : 'none' }}
                >
                  {ligne.label}
                </h3>
                <span
                  className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold"
                  style={{ background: gravite?.fond, color: gravite?.texte }}
                >
                  {gravite?.label}
                </span>
                <span className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-2.5 py-0.5 text-xs text-[var(--color-ink-soft)]">
                  {MOTEURS[ligne.engine] ?? ligne.engine}
                </span>
                {ligne.scope === 'site' ? null : (
                  <span className="text-sm text-[var(--color-ink-faint)]">
                    {ligne.affected} page{ligne.affected > 1 ? 's' : ''} sur {ligne.examined}
                  </span>
                )}
              </div>

              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {ligne.why}
              </p>

              {ligne.sample.length === 0 ? null : (
                <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
                  {ligne.sample.map((exemple) => (
                    <li
                      key={exemple.url}
                      className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-3 py-1 text-xs text-[var(--color-ink-soft)]"
                    >
                      {exemple.path}
                    </li>
                  ))}
                </ul>
              )}

              <div
                className="mt-4 inline-flex flex-wrap gap-1 rounded-[var(--radius-pill)] bg-[var(--color-canvas)] p-1"
                role="group"
                aria-label={`État de « ${ligne.label} »`}
              >
                {ETATS.map((choix) => {
                  const actif = etat === choix.id
                  return (
                    <button
                      key={choix.id}
                      type="button"
                      onClick={() => void changer(ligne.checkId, choix.id)}
                      disabled={enCours === ligne.checkId}
                      aria-pressed={actif}
                      className="rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition disabled:opacity-50"
                      style={{
                        background: actif ? 'var(--color-surface)' : 'transparent',
                        color: actif ? 'var(--color-ink)' : 'var(--color-ink-soft)',
                        boxShadow: actif ? '0 1px 3px rgba(23, 6, 47, 0.12)' : 'none',
                      }}
                    >
                      {choix.label}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
