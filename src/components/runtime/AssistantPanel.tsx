'use client'

import { useState, type FormEvent } from 'react'

/**
 * Assistant d'une application créée, côté visiteur.
 *
 * Volontairement sobre : une question, une réponse, l'échange reste visible. Aucun
 * historique n'est renvoyé au serveur — chaque question est traitée seule, ce qui borne le
 * coût et empêche un visiteur de construire un contexte à rallonge aux frais du créateur.
 */
export function AssistantPanel({
  projectId,
  blockId,
  placeholder,
}: {
  projectId: string
  blockId: string
  placeholder: string
}) {
  const [question, setQuestion] = useState('')
  const [exchange, setExchange] = useState<{ question: string; answer: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const asked = question.trim()
    if (asked.length < 2) return

    setBusy(true)
    setError(null)
    const response = await fetch(`/api/app/${projectId}/assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blockId, question: asked }),
    })
    const body = (await response.json()) as { answer?: string; message?: string }
    setBusy(false)

    if (!response.ok || body.answer === undefined) {
      setError(body.message ?? "L'assistant n'a pas pu répondre.")
      return
    }
    setExchange({ question: asked, answer: body.answer })
    setQuestion('')
  }

  return (
    <div className="grid gap-3">
      {exchange !== null ? (
        <div className="grid gap-2">
          <p
            className="m-0 justify-self-end rounded-[var(--app-radius)] px-4 py-2 text-sm"
            style={{ background: 'var(--app-primary)', color: 'var(--app-surface)' }}
          >
            {exchange.question}
          </p>
          <p
            className="m-0 rounded-[var(--app-radius)] border px-4 py-3 text-sm"
            style={{ borderColor: 'var(--app-muted)' }}
          >
            {exchange.answer}
          </p>
        </div>
      ) : null}

      {error !== null ? (
        <p className="m-0 text-sm" style={{ color: 'var(--app-primary)' }}>
          {error}
        </p>
      ) : null}

      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`${blockId}-question`}>
          {placeholder}
        </label>
        <input
          id={`${blockId}-question`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={placeholder}
          maxLength={500}
          className="min-w-0 flex-1 rounded-[var(--app-radius)] border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-[var(--app-radius)] px-5 py-2 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--app-primary)', color: 'var(--app-surface)' }}
        >
          {busy ? '…' : 'Demander'}
        </button>
      </form>
    </div>
  )
}
