'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'

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
 * Le passage de relais du coach vers l'assistant.
 *
 * Le coach explique le parcours ; il ne voit pas l'application. L'assistant, lui, sait
 * l'ouvrir, lire ses contrôles et ce qui a échoué — mais il vit dans un onglet du projet,
 * auquel le coach n'a aucun accès direct. Un événement du navigateur les relie sans faire
 * passer une propriété à travers tout le cadre : là où la page du projet écoute, le bouton
 * apparaît ; ailleurs, il n'existe pas, ce qui est exactement le bon comportement.
 */
export const RELAIS_ASSISTANT = 'evoliia:demander-a-l-assistant'

export function CoachLauncher({ screen }: { screen: string }) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signalement, setSignalement] = useState('')
  const [envoi, setEnvoi] = useState<'idle' | 'busy' | 'sent'>('idle')
  const scroller = useRef<HTMLDivElement>(null)
  // Le relais n'a de sens que là où un projet est ouvert, et c'est la page qui le sait.
  const surUnProjet = screen === 'projet'
  const derniere = turns[turns.length - 1]?.question ?? ''

  /** Ouvre l'assistant du projet avec une demande déjà rédigée. */
  function passerLaMain() {
    const sujet = derniere === '' ? 'Quelque chose ne marche pas dans mon application.' : derniere
    window.dispatchEvent(
      new CustomEvent(RELAIS_ASSISTANT, {
        detail: [
          `Il y a un problème dans mon application : « ${sujet} »`,
          '',
          'Regarde les contrôles et ce qui a échoué récemment, dis-moi ce qui se passe, et',
          'corrige-le si tu peux.',
        ].join('\n'),
      }),
    )
    setOpen(false)
  }

  async function signaler() {
    const texte = signalement.trim()
    if (texte.length < 10 || envoi === 'busy') return
    setEnvoi('busy')
    setError(null)
    const response = await fetch('/api/coach/signaler', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: texte, screen }),
    })
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    if (body === null || !response.ok) {
      setError(body?.message ?? "Le signalement n'a pas pu être envoyé.")
      setEnvoi('idle')
      return
    }
    setSignalement('')
    setEnvoi('sent')
  }

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
        onClick={() => setOpen(true)}
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

        {/*
          Les deux sorties du coach, dans l'ordre où elles doivent être tentées.
          Le coach explique ; il ne voit pas l'application. Quand le problème est dedans,
          c'est l'assistant qui doit regarder, et le créateur n'a pas à savoir que ce sont
          deux entités différentes : un bouton suffit.
        */}
        {surUnProjet ? (
          <div className="mt-5 border-t border-[var(--color-line)] pt-4">
            <p className="m-0 mb-2 text-xs text-[var(--color-ink-soft)]">
              Le coach explique le parcours, mais il ne voit pas votre application.
            </p>
            <button
              type="button"
              onClick={passerLaMain}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-brand)] px-3 py-2 text-sm font-medium text-[var(--color-brand-strong)]"
            >
              Demander à l’assistant de regarder mon application
            </button>
          </div>
        ) : null}

        <details className="mt-4 border-t border-[var(--color-line)] pt-4">
          <summary className="cursor-pointer text-xs text-[var(--color-ink-soft)]">
            Rien ne résout votre problème ? Signalez-le.
          </summary>
          {envoi === 'sent' ? (
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
                value={signalement}
                onChange={(event) => setSignalement(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="J’ai voulu publier et il ne se passe rien…"
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void signaler()}
                disabled={envoi === 'busy' || signalement.trim().length < 10}
                className="justify-self-start rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-sm disabled:opacity-50"
              >
                {envoi === 'busy' ? 'Envoi…' : 'Envoyer le signalement'}
              </button>
            </div>
          )}
        </details>
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
