'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ReportProblem } from './ReportProblem'

/**
 * Coach, accessible depuis tous les écrans du studio.
 *
 * Volontairement discret : un bouton en bas de l'écran, un panneau qui s'ouvre. La personne
 * qui sait où elle va ne le voit presque pas ; celle qui bloque le trouve sans chercher.
 *
 * Le coût est annoncé avant la première question, pas découvert après. Deux suggestions
 * suffisent à montrer le genre de question qu'on peut poser, sans transformer le panneau
 * en menu.
 */

type Turn = { question: string; answer: string }

const SUGGESTIONS = [
  'Je ne comprends pas ce qu’on me demande ici.',
  'Qu’est-ce que je dois faire maintenant ?',
] as const

/**
 * Ouvrir la conversation du projet.
 *
 * Sur la page d'un projet, il n'y a qu'un seul interlocuteur : l'assistant. Il construit et
 * il dépanne, et le créateur n'a pas à savoir lequel des deux il est en train de demander.
 * Le bouton d'aide y mène donc directement, au lieu d'ouvrir un second chat qui renverrait
 * vers le premier — c'était une passerelle entre deux conversations là où il n'en fallait
 * qu'une.
 *
 * Le coach reste seul maître des écrans sans projet : objectif, idées, tableau de bord. Là,
 * il n'y a pas d'assistant, et expliquer le parcours est exactement ce qu'il sait faire.
 *
 * Un événement du navigateur suffit à relier le cadre au contenu, sans faire traverser une
 * propriété à toute l'application.
 */
export const RELAIS_ASSISTANT = 'evoliia:ouvrir-l-assistant'

export function CoachLauncher({ screen }: { screen: string }) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // Là où un projet est ouvert, l'assistant est le seul interlocuteur : le coach s'efface.
  const surUnProjet = screen === 'projet'

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [turns, busy])

  async function ask(text: string) {
    const asked = text.trim()
    if (asked.length < 3 || busy) return
    setBusy(true)
    setError(null)
    setQuestion('')

    const response = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: asked, screen, history: turns.slice(-2) }),
    })
    const body = (await response.json()) as { answer?: string; message?: string }
    setBusy(false)

    if (!response.ok || body.answer === undefined) {
      setError(body.message ?? "Le coach n'a pas pu répondre.")
      return
    }
    setTurns((current) => [...current, { question: asked, answer: body.answer as string }])
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          // Sur un projet, l'aide mène à la conversation qui peut agir, pas à une seconde
          // conversation qui y renverrait.
          if (surUnProjet) window.dispatchEvent(new CustomEvent(RELAIS_ASSISTANT))
          else setOpen(true)
        }}
        className="fixed bottom-5 right-5 z-40 rounded-full px-5 py-3 text-sm font-medium text-white shadow-lg"
        style={{ background: 'var(--gradient-brand)' }}
      >
        Besoin d’aide ?
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex max-h-[min(32rem,80vh)] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <p className="m-0 text-sm font-semibold">Votre coach</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fermer"
          className="ml-auto text-[var(--color-ink-soft)]"
        >
          ✕
        </button>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="grid gap-3">
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">
              Posez votre question en français, comme à quelqu’un à côté de vous. Le coach
              sait où vous en êtes dans votre parcours.
            </p>
            <div className="grid gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void ask(suggestion)}
                  className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-left text-sm text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {turns.map((turn) => (
              <div key={turn.question} className="grid gap-2">
                <p className="m-0 justify-self-end rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 py-2 text-sm text-white">
                  {turn.question}
                </p>
                <p className="m-0 whitespace-pre-line rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-3 py-2 text-sm">
                  {turn.answer}
                </p>
              </div>
            ))}
          </div>
        )}

        {busy ? (
          <p className="mt-4 text-sm text-[var(--color-ink-soft)]">Le coach réfléchit…</p>
        ) : null}
        {error !== null ? (
          <p className="mt-4 text-sm text-[var(--color-critical)]">{error}</p>
        ) : null}

        <ReportProblem screen={screen} />
      </div>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void ask(question)
        }}
        className="border-t border-[var(--color-line)] p-3"
      >
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Votre question…"
            maxLength={600}
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Envoyer
          </button>
        </div>
        <p className="m-0 mt-2 text-xs text-[var(--color-ink-faint)]">
          Une question coûte un crédit. Le coach explique et oriente, il ne construit pas à
          votre place.
        </p>
      </form>
    </div>
  )
}
