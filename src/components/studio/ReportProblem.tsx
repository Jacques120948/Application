'use client'

import { useState } from 'react'

/**
 * Le dernier recours, replié.
 *
 * Il vit partout où quelqu'un peut se retrouver bloqué : dans la conversation d'un projet,
 * où l'assistant vient d'échouer, et dans le coach, sur les écrans qui n'ont pas
 * d'assistant. Un seul composant pour les deux, parce que deux copies finiraient par
 * demander deux choses différentes et par en oublier une.
 *
 * Replié par défaut, et c'est délibéré : ce n'est pas la première chose à essayer. Celui qui
 * l'ouvre a déjà tenté le reste, et il ne doit alors pas avoir à raconter sa vie — son
 * offre, son solde et ses erreurs récentes partent avec, rassemblés par le serveur.
 */
export function ReportProblem({ screen, projectId }: { screen: string; projectId?: string }) {
  const [texte, setTexte] = useState('')
  const [etat, setEtat] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function envoyer() {
    const message = texte.trim()
    if (message.length < 10 || etat === 'busy') return
    setEtat('busy')
    setError(null)
    const response = await fetch('/api/coach/signaler', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        screen,
        ...(projectId === undefined ? {} : { projectId }),
      }),
    })
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    if (body === null || !response.ok) {
      setError(body?.message ?? "Le signalement n'a pas pu être envoyé.")
      setEtat('idle')
      return
    }
    setTexte('')
    setEtat('sent')
  }

  return (
    <details className="mt-4 border-t border-[var(--color-line)] pt-3">
      <summary className="cursor-pointer text-xs text-[var(--color-ink-soft)]">
        Rien ne résout votre problème ? Signalez-le.
      </summary>
      {etat === 'sent' ? (
        <p className="m-0 mt-2 text-sm">
          C’est envoyé, merci. Nous savons désormais que vous êtes bloqué, et sur quoi.
        </p>
      ) : (
        <div className="mt-2 grid gap-2">
          <p className="m-0 text-xs text-[var(--color-ink-faint)]">
            Décrivez ce qui ne se passe pas comme prévu. Votre offre, vos crédits et les
            erreurs récentes de votre compte partent avec : inutile de les chercher.
          </p>
          <textarea
            value={texte}
            onChange={(event) => setTexte(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="J’ai voulu publier et il ne se passe rien…"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-sm"
          />
          {error !== null ? (
            <p className="m-0 text-xs text-[var(--color-critical)]">{error}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void envoyer()}
            disabled={etat === 'busy' || texte.trim().length < 10}
            className="justify-self-start rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-sm disabled:opacity-50"
          >
            {etat === 'busy' ? 'Envoi…' : 'Envoyer le signalement'}
          </button>
        </div>
      )}
    </details>
  )
}
