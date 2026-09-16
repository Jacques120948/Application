'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Notice, Textarea } from '@/components/ui'

type Message = {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  /** Ce que l'agent a fait pour répondre. Absent des messages relus depuis la base. */
  trace?: Trace
}

/**
 * Ce que l'agent a regardé et ce qu'il a coûté.
 *
 * Affiché discrètement sous sa réponse, et pour une raison qui n'est pas cosmétique : le
 * créateur paie l'opération, il a le droit de savoir ce qu'elle a mobilisé. Une réponse qui
 * arrive sans rien dire de son travail est une boîte noire, et une boîte noire qui facture
 * n'inspire pas confiance longtemps.
 */
type Trace = { read: string[]; steps: number; credits: number }

/** « Pages lues : accueil, tarifs · 3 étapes · 4 crédits ». Rien quand il n'y a rien à dire. */
function describeTrace(trace: Trace): string {
  const morceaux: string[] = []
  if (trace.read.length > 0) morceaux.push(`Pages lues : ${trace.read.join(', ')}`)
  morceaux.push(`${trace.steps} étape${trace.steps > 1 ? 's' : ''}`)
  if (trace.credits > 0) morceaux.push(`${trace.credits} crédit${trace.credits > 1 ? 's' : ''}`)
  return morceaux.join(' · ')
}

/**
 * Conversation avec l'assistant (sections 5 et 20).
 * L'utilisateur écrit en français courant ; il ne voit jamais de code.
 */
export function ChatPanel({
  projectId,
  initialMessages,
  onApplied,
  initialDraft = '',
}: {
  projectId: string
  initialMessages: Message[]
  onApplied: () => void
  /** Une demande préparée ailleurs (une analyse de Lia, par exemple) : proposée, jamais envoyée seule. */
  initialDraft?: string
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState(initialDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // On fait défiler le conteneur de la conversation, jamais la page : `scrollIntoView`
  // ferait remonter toute la fenêtre et chasserait l'aperçu hors de l'écran.
  useEffect(() => {
    if (initialDraft !== '') setDraft(initialDraft)
  }, [initialDraft])

  useEffect(() => {
    const container = scrollRef.current
    if (container !== null) container.scrollTop = container.scrollHeight
  }, [messages.length, busy])

  async function send() {
    const message = draft.trim()
    if (message.length < 3 || busy) return

    setBusy(true)
    setError(null)
    setDraft('')
    setMessages((current) => [
      ...current,
      { id: `local-${current.length}`, role: 'USER', content: message },
    ])

    const response = await fetch(`/api/projects/${projectId}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    // Une réponse qui n'est pas du JSON vient de l'hébergeur, pas de l'assistant : elle ne
    // doit pas laisser le bouton en attente pour toujours.
    const body = (await response.json().catch(() => null)) as {
      reply?: string
      applied?: boolean
      message?: string
      read?: string[]
      steps?: number
      creditsSpent?: number
    } | null

    if (body === null || !response.ok) {
      setError(body?.message ?? "L'assistant n'a pas pu traiter votre demande.")
      setBusy(false)
      return
    }

    setMessages((current) => [
      ...current,
      {
        id: `reply-${current.length}`,
        role: 'ASSISTANT',
        content: body.reply ?? '',
        ...(body.steps === undefined
          ? {}
          : {
              trace: {
                read: body.read ?? [],
                steps: body.steps,
                credits: body.creditsSpent ?? 0,
              },
            }),
      },
    ])
    setBusy(false)
    if (body.applied === true) onApplied()
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Dites ce que vous voulez changer. Par exemple : « Mets le bouton en bleu », « Ajoute
            une page à propos », « Ajoute un abonnement à 9,90 € par mois ».
          </p>
        ) : null}
        <div className="grid gap-3">
          {messages.map((message) => (
            <div key={message.id} className="grid gap-1">
              <div
                className={
                  message.role === 'USER'
                    ? 'justify-self-end rounded-[var(--radius-card)] bg-[var(--color-brand)] px-3.5 py-2.5 text-sm text-white max-w-[85%] whitespace-pre-wrap'
                    : 'justify-self-start rounded-[var(--radius-card)] bg-[var(--color-canvas)] px-3.5 py-2.5 text-sm max-w-[90%] whitespace-pre-wrap'
                }
              >
                {message.content}
              </div>
              {message.trace !== undefined ? (
                <p className="m-0 justify-self-start text-xs text-[var(--color-ink-soft)]">
                  {describeTrace(message.trace)}
                </p>
              ) : null}
            </div>
          ))}
          {busy ? (
            <p className="text-sm text-[var(--color-ink-soft)]">L&apos;assistant travaille…</p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-[var(--color-line)] p-3">
        {error !== null ? (
          <div className="mb-3">
            <Notice tone="critical">{error}</Notice>
          </div>
        ) : null}
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send()
          }}
          placeholder="Dites ce que vous voulez changer…"
          maxLength={2000}
          className="min-h-20"
        />
        <Button className="mt-2 w-full" onClick={() => void send()} disabled={busy}>
          {busy ? '…' : 'Envoyer'}
        </Button>
      </div>
    </div>
  )
}
