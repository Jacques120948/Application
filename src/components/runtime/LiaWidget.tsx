'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getTranslator, resolveLocale } from '@/i18n'
import type { Theme } from '@/server/spec/schema'
import { themeStyle } from './theme'

/**
 * Lia, côté visiteur d'une application créée.
 *
 * Un bouton discret, un panneau qui s'ouvre, une conversation. Le widget ne connaît que
 * l'identifiant de l'application et celui de sa conversation ; il n'a aucune clé, aucun
 * secret, et tout ce qu'il envoie est vérifié côté serveur. Ses couleurs sont celles de
 * l'application (variables du thème), sauf si le créateur a choisi un accent.
 *
 * Trois choses dites honnêtement : Lia est une assistante automatique ; quand elle ne sait
 * pas, elle le dit et propose de transmettre ; transmettre crée une demande que le
 * créateur lira, sans promettre une réponse immédiate.
 */

type Turn = { role: 'visitor' | 'lia' | 'owner'; content: string; escalate?: boolean }

const MAX_LENGTH = 800

export function LiaWidget({
  projectId,
  locale,
  displayName,
  greeting,
  position,
  accentColor,
  hasAccount,
  theme,
}: {
  projectId: string
  locale: string
  displayName: string
  greeting: string
  position: 'bottom-right' | 'bottom-left'
  accentColor: string | null
  hasAccount: boolean
  /** Le thème de l'application : le widget vit hors de sa racine, il porte donc ses variables lui-même. */
  theme: Theme
}) {
  const t = getTranslator(resolveLocale(locale))
  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [escalating, setEscalating] = useState(false)
  const [ticketEmail, setTicketEmail] = useState('')
  const [ticketMessage, setTicketMessage] = useState('')
  const [ticketSent, setTicketSent] = useState(false)
  const [rated, setRated] = useState<1 | -1 | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const storageKey = `lia:${projectId}`

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [turns, busy, escalating])

  // La conversation survit à un rechargement de la page, dans l'onglet seulement : c'est un
  // identifiant de conversation, pas un secret, et il ne donne accès qu'à ce que ce
  // visiteur a lui-même écrit.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved !== null) {
        setConversationId(saved)
        void fetch(`/api/app/${projectId}/lia/messages?conversation=${saved}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((body: { messages?: Array<{ role: Turn['role']; content: string }> } | null) => {
            if (body?.messages) setTurns(body.messages.map((m) => ({ role: m.role, content: m.content })))
          })
          .catch(() => undefined)
      }
    } catch {
      // Stockage indisponible : la conversation ne survivra pas au rechargement, rien de plus.
    }
  }, [projectId, storageKey])

  async function ensureConversation(): Promise<string | null> {
    if (conversationId !== null) return conversationId
    const response = await fetch(`/api/app/${projectId}/lia`, { method: 'POST' })
    const body = (await response.json()) as { conversationId?: string; message?: string }
    if (!response.ok || body.conversationId === undefined) {
      setError(body.message ?? t('lia.unavailable'))
      return null
    }
    setConversationId(body.conversationId)
    try {
      sessionStorage.setItem(storageKey, body.conversationId)
    } catch {
      // Idem.
    }
    return body.conversationId
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (content.length === 0 || busy) return
    setBusy(true)
    setError(null)
    setDraft('')
    setTurns((current) => [...current, { role: 'visitor', content }])

    const id = await ensureConversation()
    if (id === null) {
      setBusy(false)
      return
    }
    const response = await fetch(`/api/app/${projectId}/lia/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: id, content }),
    })
    const body = (await response.json()) as {
      answer?: string
      escalationSuggested?: boolean
      message?: string
    }
    setBusy(false)
    if (!response.ok || body.answer === undefined) {
      setError(body.message ?? t('lia.unavailable'))
      setTicketMessage(content)
      return
    }
    setTurns((current) => [...current, { role: 'lia', content: body.answer as string, escalate: body.escalationSuggested }])
    if (body.escalationSuggested) setTicketMessage(content)
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = ticketMessage.trim()
    if (message.length < 3 || busy) return
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/app/${projectId}/lia/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversationId ?? undefined,
        email: ticketEmail.trim() === '' ? undefined : ticketEmail.trim(),
        message,
      }),
    })
    const body = (await response.json()) as { ticketId?: string; message?: string }
    setBusy(false)
    if (!response.ok || body.ticketId === undefined) {
      setError(body.message ?? t('lia.ticketError'))
      return
    }
    setTicketSent(true)
    setEscalating(false)
  }

  async function rate(value: 1 | -1) {
    if (conversationId === null || rated !== null) return
    setRated(value)
    await fetch(`/api/app/${projectId}/lia/avis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId, satisfaction: value }),
    }).catch(() => undefined)
  }

  const side = position === 'bottom-left' ? 'left-4' : 'right-4'
  const vars = themeStyle(theme)
  const accent = accentColor ?? 'var(--app-primary)'
  const onAccent = accentColor === null ? 'var(--app-on-primary)' : '#ffffff'
  const lastLia = [...turns].reverse().find((turn) => turn.role === 'lia')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('lia.open')}
        className={`fixed bottom-4 ${side} z-40 inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition`}
        style={{ ...vars, background: accent, color: onAccent, outlineColor: accent }}
      >
        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current opacity-80" />
        {t('lia.needHelp')}
      </button>
    )
  }

  return (
    <section
      role="dialog"
      aria-label={t('lia.dialogLabel', { name: displayName })}
      className={`fixed bottom-4 ${side} z-40 flex max-h-[min(34rem,85vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden border shadow-2xl`}
      style={{
        ...vars,
        background: 'var(--app-surface)',
        color: 'var(--app-text)',
        borderColor: 'var(--app-border)',
        borderRadius: 'var(--app-radius-lg)',
      }}
    >
      <header className="flex items-center gap-3 px-4 py-3" style={{ background: accent, color: onAccent }}>
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold">{displayName}</p>
          <p className="m-0 text-xs opacity-90">{t('lia.automated')}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('lia.close')}
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-lg leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: onAccent, outlineColor: onAccent }}
        >
          ✕
        </button>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        <div className="grid gap-3">
          <p className="m-0 max-w-[85%] rounded-[var(--app-radius)] px-3 py-2 text-sm" style={{ background: 'var(--app-surface-alt)' }}>
            {greeting}
          </p>
          {turns.map((turn, index) => (
            <div key={`${index}-${turn.role}`} className="grid gap-2">
              <p
                className={`m-0 max-w-[85%] whitespace-pre-line rounded-[var(--app-radius)] px-3 py-2 text-sm ${turn.role === 'visitor' ? 'justify-self-end' : ''}`}
                style={
                  turn.role === 'visitor'
                    ? { background: accent, color: onAccent }
                    : { background: 'var(--app-surface-alt)' }
                }
              >
                {turn.role === 'owner' ? <span className="mb-1 block text-xs opacity-70">{t('lia.fromTeam')}</span> : null}
                {turn.content}
              </p>
              {turn.role === 'lia' && turn.escalate && !ticketSent && !escalating ? (
                <button
                  type="button"
                  onClick={() => setEscalating(true)}
                  className="justify-self-start rounded-[var(--app-radius)] border px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ borderColor: accent, color: accent, outlineColor: accent }}
                >
                  {t('lia.escalate')}
                </button>
              ) : null}
            </div>
          ))}
          {busy && !escalating ? <p className="m-0 text-sm opacity-70">{t('lia.thinking')}</p> : null}
          {error !== null ? (
            <div className="grid gap-2">
              <p className="m-0 rounded-[var(--app-radius)] px-3 py-2 text-sm" style={{ background: 'var(--app-surface-alt)' }}>
                {error}
              </p>
              {!ticketSent && !escalating ? (
                <button
                  type="button"
                  onClick={() => setEscalating(true)}
                  className="justify-self-start rounded-[var(--app-radius)] border px-3 py-1.5 text-sm font-medium"
                  style={{ borderColor: accent, color: accent }}
                >
                  {t('lia.escalate')}
                </button>
              ) : null}
            </div>
          ) : null}
          {ticketSent ? (
            <p className="m-0 rounded-[var(--app-radius)] px-3 py-2 text-sm" style={{ background: 'var(--app-surface-alt)' }}>
              {t('lia.ticketSent')}
            </p>
          ) : null}
          {lastLia !== undefined && !busy && rated === null && !escalating ? (
            <div className="flex items-center gap-2 text-xs opacity-80">
              <span>{t('lia.helpful')}</span>
              <button type="button" onClick={() => void rate(1)} aria-label={t('lia.yes')} className="rounded px-2 py-1 hover:opacity-100">
                👍
              </button>
              <button type="button" onClick={() => void rate(-1)} aria-label={t('lia.no')} className="rounded px-2 py-1 hover:opacity-100">
                👎
              </button>
            </div>
          ) : null}
          {rated !== null ? <p className="m-0 text-xs opacity-70">{t('lia.thanks')}</p> : null}
        </div>
      </div>

      {escalating ? (
        <form onSubmit={submitTicket} className="grid gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--app-border)' }}>
          <p className="m-0 text-xs opacity-80">{t('lia.escalateHint')}</p>
          {!hasAccount ? (
            <label className="grid gap-1 text-xs">
              {t('lia.emailOptional')}
              <input
                type="email"
                value={ticketEmail}
                onChange={(event) => setTicketEmail(event.target.value)}
                className="rounded-[var(--app-radius)] border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--app-border)', background: 'var(--app-background)', color: 'var(--app-text)' }}
                autoComplete="email"
              />
            </label>
          ) : null}
          <label className="grid gap-1 text-xs">
            {t('lia.yourRequest')}
            <textarea
              required
              value={ticketMessage}
              onChange={(event) => setTicketMessage(event.target.value.slice(0, 2000))}
              rows={3}
              className="rounded-[var(--app-radius)] border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--app-border)', background: 'var(--app-background)', color: 'var(--app-text)' }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-10 rounded-[var(--app-radius)] px-4 py-2 text-sm font-medium disabled:opacity-60"
              style={{ background: accent, color: onAccent }}
            >
              {t('lia.send')}
            </button>
            <button type="button" onClick={() => setEscalating(false)} className="min-h-10 px-3 text-sm opacity-80">
              {t('lia.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={send} className="flex items-end gap-2 border-t px-3 py-3" style={{ borderColor: 'var(--app-border)' }}>
          <label className="sr-only" htmlFor={`lia-input-${projectId}`}>
            {t('lia.placeholder')}
          </label>
          <textarea
            id={`lia-input-${projectId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            rows={1}
            placeholder={t('lia.placeholder')}
            className="min-h-10 flex-1 resize-none rounded-[var(--app-radius)] border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--app-border)', background: 'var(--app-background)', color: 'var(--app-text)' }}
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            className="min-h-10 rounded-[var(--app-radius)] px-4 py-2 text-sm font-medium disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ background: accent, color: onAccent, outlineColor: accent }}
          >
            {t('lia.send')}
          </button>
        </form>
      )}
    </section>
  )
}
