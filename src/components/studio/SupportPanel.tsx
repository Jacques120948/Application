'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { getTranslator, resolveLocale, type MessageKey } from '@/i18n'
import { builderRequestFor } from '@/lib/support'
import { Badge, Button, EmptyState, Field, Input, Notice, Select, Textarea } from '@/components/ui'

/**
 * Lia côté créateur : l'onglet « Support » d'un projet.
 *
 * Cinq vues dans un même panneau, parce que c'est un seul sujet — ce que les utilisateurs
 * de l'application demandent — vu sous cinq angles : les chiffres, les conversations, les
 * demandes transmises, ce que Lia a le droit de dire, et comment elle se présente. La
 * sixième vue (analyses) n'existe qu'avec le drapeau de la V2.
 */

type Access = { state: 'open' | 'locked' | 'closed'; availableWith: string | null }

type Settings = {
  enabled: boolean
  displayName: string
  greeting: string
  position: 'bottom-right' | 'bottom-left'
  accentColor: string | null
  escalationEmail: string | null
  retentionDays: number
}

type Quota = { used: number; limit: number; remaining: number; resetsAt: string }

type Overview = {
  access: Access
  settings: Settings
  quota: { answers: Quota; conversations: Quota }
  stats: {
    conversations: number
    answers: number
    grounded: number
    escalated: number
    openTickets: number
    thumbsUp: number
    thumbsDown: number
    categories: Array<{ category: string; count: number }>
  }
  knowledge: { published: number; draft: number; disabled: number }
}

type Entry = { id: string; kind: string; question: string; answer: string; keywords: string; status: 'draft' | 'published' | 'disabled' }

type Conversation = {
  id: string
  status: 'open' | 'escalated' | 'closed'
  category: string | null
  messageCount: number
  answeredCount: number
  satisfaction: number | null
  preview: string
  hasAccount: boolean
  lastMessageAt: string
}

type ConversationMessage = { id: string; role: 'visitor' | 'lia' | 'owner'; content: string; grounded: boolean; createdAt: string }

type Ticket = {
  id: string
  conversationId: string | null
  email: string | null
  subject: string
  category: string
  priority: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  createdAt: string
}

type Insight = {
  id: string
  kind: 'frequent_question' | 'feature_request' | 'potential_bug' | 'unanswered'
  title: string
  count: number
  examples: string[]
  status: 'new' | 'roadmap' | 'dismissed'
}

type View = 'overview' | 'conversations' | 'tickets' | 'knowledge' | 'settings' | 'insights'

const CATEGORY_KEYS: Record<string, MessageKey> = {
  usage: 'support.category.usage',
  account: 'support.category.account',
  billing: 'support.category.billing',
  bug: 'support.category.bug',
  feature: 'support.category.feature',
  other: 'support.category.other',
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const body = (await response.json().catch(() => ({}))) as T & { message?: string }
  if (!response.ok) return { ok: false, message: body.message ?? 'Erreur' }
  return { ok: true, body }
}

export function SupportPanel({
  projectId,
  locale,
  liaV2,
  faqCredits,
  insightsCredits,
  onSendToBuilder,
}: {
  projectId: string
  locale: string
  liaV2: boolean
  faqCredits: number
  insightsCredits: number
  onSendToBuilder: (text: string) => void
}) {
  const t = getTranslator(resolveLocale(locale))
  const [view, setView] = useState<View>('overview')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `/api/projects/${projectId}/support`
  const categoryLabel = (category: string | null) => {
    const key = category === null ? undefined : CATEGORY_KEYS[category]
    return key === undefined ? t('support.category.other') : t(key)
  }

  const loadOverview = useCallback(async () => {
    const result = await call<Overview>(base)
    if (!result.ok) setLoadError(result.message)
    else setOverview(result.body)
  }, [base])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  if (loadError !== null) {
    return (
      <div className="p-4">
        <Notice tone="critical">{loadError}</Notice>
      </div>
    )
  }
  if (overview === null) return <p className="p-4 text-sm text-[var(--color-ink-soft)]">{t('support.loading')}</p>

  const access = overview.access
  const views: Array<{ id: View; label: string }> = [
    { id: 'overview', label: t('support.view.overview') },
    { id: 'conversations', label: t('support.view.conversations') },
    { id: 'tickets', label: t('support.view.tickets') },
    { id: 'knowledge', label: t('support.view.knowledge') },
    { id: 'settings', label: t('support.view.settings') },
    ...(liaV2 ? [{ id: 'insights' as const, label: t('support.view.insights') }] : []),
  ]

  return (
    <div className="grid gap-4 p-4">
      {access.state === 'closed' ? <Notice tone="neutral">{t('support.closed')}</Notice> : null}
      {access.state === 'locked' ? (
        <Notice tone="caution">
          {t('support.locked')}{' '}
          {access.availableWith !== null ? t('support.availableWith', { plan: access.availableWith }) : ''}
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('support.title')}>
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === view}
            onClick={() => {
              setView(item.id)
              setError(null)
              setNotice(null)
            }}
            className={
              item.id === view
                ? 'rounded-[var(--radius-control)] bg-[var(--color-brand-soft)] px-3 py-1.5 text-sm font-medium text-[var(--color-brand-strong)]'
                : 'rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {error !== null ? <Notice tone="critical">{error}</Notice> : null}
      {notice !== null ? <Notice tone="positive">{notice}</Notice> : null}

      {view === 'overview' ? <OverviewView overview={overview} t={t} locale={locale} categoryLabel={categoryLabel} onGo={setView} /> : null}
      {view === 'conversations' ? (
        <ConversationsView base={base} t={t} locale={locale} categoryLabel={categoryLabel} setError={setError} />
      ) : null}
      {view === 'tickets' ? <TicketsView base={base} t={t} locale={locale} categoryLabel={categoryLabel} setError={setError} setNotice={setNotice} /> : null}
      {view === 'knowledge' ? (
        <KnowledgeView
          base={base}
          t={t}
          locale={locale}
          canWrite={access.state === 'open'}
          faqCredits={faqCredits}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setNotice={setNotice}
          onChanged={loadOverview}
        />
      ) : null}
      {view === 'settings' ? (
        <SettingsView
          base={base}
          t={t}
          settings={overview.settings}
          canEnable={access.state === 'open'}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setNotice={setNotice}
          onSaved={loadOverview}
        />
      ) : null}
      {view === 'insights' && liaV2 ? (
        <InsightsView
          base={base}
          t={t}
          locale={locale}
          credits={insightsCredits}
          canRun={access.state === 'open'}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setNotice={setNotice}
          onSendToBuilder={onSendToBuilder}
        />
      ) : null}
    </div>
  )
}

type T = ReturnType<typeof getTranslator>

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5">
      <p className="m-0 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">{label}</p>
      <p className="m-0 text-xl font-semibold">{value}</p>
      {hint ? <p className="m-0 text-xs text-[var(--color-ink-faint)]">{hint}</p> : null}
    </div>
  )
}

function OverviewView({
  overview,
  t,
  locale,
  categoryLabel,
  onGo,
}: {
  overview: Overview
  t: T
  locale: string
  categoryLabel: (c: string | null) => string
  onGo: (view: View) => void
}) {
  const { stats, settings, quota, knowledge } = overview
  const rate = stats.answers === 0 ? null : Math.round((stats.grounded / stats.answers) * 100)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={settings.enabled ? 'positive' : 'neutral'}>{settings.enabled ? t('support.active') : t('support.inactive')}</Badge>
        <span className="text-sm text-[var(--color-ink-soft)]">{t('support.overviewHint')}</span>
        <Button type="button" variant="secondary" className="ml-auto" onClick={() => onGo('settings')}>
          {t('support.configure')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={t('support.stat.conversations')} value={stats.conversations} hint={t('support.last30')} />
        <Stat label={t('support.stat.openTickets')} value={stats.openTickets} />
        <Stat label={t('support.stat.answerRate')} value={rate === null ? '—' : `${rate} %`} hint={t('support.stat.answerRateHint')} />
        <Stat label={t('support.stat.unanswered')} value={stats.answers - stats.grounded} hint={t('support.last30')} />
        <Stat label={t('support.stat.satisfaction')} value={`👍 ${stats.thumbsUp} · 👎 ${stats.thumbsDown}`} />
        <Stat label={t('support.stat.knowledge')} value={knowledge.published} hint={t('support.stat.knowledgeHint', { draft: knowledge.draft })} />
      </div>
      <p className="m-0 text-xs text-[var(--color-ink-faint)]">
        {t('support.quota', {
          answersUsed: quota.answers.used,
          answersLimit: quota.answers.limit,
          conversationsUsed: quota.conversations.used,
          conversationsLimit: quota.conversations.limit,
          date: new Date(quota.answers.resetsAt).toLocaleDateString(`${locale}-CH`),
        })}
      </p>
      {stats.categories.length > 0 ? (
        <div>
          <p className="m-0 mb-1 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">{t('support.stat.categories')}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {stats.categories.map((row) => (
              <li key={row.category}>
                <Badge tone="neutral">
                  {categoryLabel(row.category)} · {row.count}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {stats.conversations === 0 ? (
        <EmptyState title={t('support.emptyOverview')} body={t('support.emptyOverviewBody')} />
      ) : null}
    </div>
  )
}

function ConversationsView({
  base,
  t,
  locale,
  categoryLabel,
  setError,
}: {
  base: string
  t: T
  locale: string
  categoryLabel: (c: string | null) => string
  setError: (e: string | null) => void
}) {
  const [list, setList] = useState<Conversation[] | null>(null)
  const [status, setStatus] = useState<'' | Conversation['status']>('')
  const [selected, setSelected] = useState<{ conversation: Conversation; messages: ConversationMessage[]; endUserEmail: string | null } | null>(null)

  const load = useCallback(async () => {
    const result = await call<{ conversations: Conversation[] }>(`${base}/conversations${status === '' ? '' : `?statut=${status}`}`)
    if (!result.ok) setError(result.message)
    else setList(result.body.conversations)
  }, [base, status, setError])

  useEffect(() => {
    void load()
  }, [load])

  async function openOne(id: string) {
    const result = await call<{ conversation: Conversation; messages: ConversationMessage[]; endUserEmail: string | null }>(`${base}/conversations?id=${id}`)
    if (!result.ok) setError(result.message)
    else setSelected(result.body)
  }

  async function remove(id: string) {
    if (!window.confirm(t('support.confirmDelete'))) return
    const result = await call(`${base}/conversations`, { method: 'DELETE', body: JSON.stringify({ id }) })
    if (!result.ok) setError(result.message)
    else {
      setSelected(null)
      await load()
    }
  }

  async function close(id: string) {
    const result = await call(`${base}/conversations`, { method: 'PUT', body: JSON.stringify({ id, action: 'close' }) })
    if (!result.ok) setError(result.message)
    else {
      setSelected(null)
      await load()
    }
  }

  if (selected !== null) {
    return (
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
            ← {t('support.back')}
          </Button>
          <Badge tone={selected.conversation.status === 'escalated' ? 'caution' : 'neutral'}>{t(`support.status.${selected.conversation.status}` as MessageKey)}</Badge>
          <Badge tone="neutral">{categoryLabel(selected.conversation.category)}</Badge>
          {selected.endUserEmail !== null ? <span className="text-xs text-[var(--color-ink-soft)]">{selected.endUserEmail}</span> : null}
          <span className="ml-auto flex gap-2">
            {selected.conversation.status !== 'closed' ? (
              <Button type="button" variant="secondary" onClick={() => void close(selected.conversation.id)}>
                {t('support.close')}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => void remove(selected.conversation.id)}>
              {t('support.delete')}
            </Button>
          </span>
        </div>
        <div className="grid gap-2">
          {selected.messages.map((message) => (
            <p
              key={message.id}
              className={`m-0 max-w-[90%] whitespace-pre-line rounded-[var(--radius-control)] px-3 py-2 text-sm ${
                message.role === 'visitor'
                  ? 'bg-[var(--color-canvas)]'
                  : message.role === 'owner'
                    ? 'justify-self-end bg-[var(--color-brand-soft)]'
                    : 'justify-self-end bg-[var(--color-brand)] text-white'
              }`}
            >
              <span className="mb-0.5 block text-[11px] uppercase tracking-wide opacity-70">
                {message.role === 'visitor' ? t('support.role.visitor') : message.role === 'owner' ? t('support.role.owner') : t('support.role.lia')}
                {message.role === 'lia' && !message.grounded ? ` · ${t('support.notGrounded')}` : ''}
              </span>
              {message.content}
            </p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="max-w-xs">
          <option value="">{t('support.allStatuses')}</option>
          <option value="open">{t('support.status.open')}</option>
          <option value="escalated">{t('support.status.escalated')}</option>
          <option value="closed">{t('support.status.closed')}</option>
        </Select>
      </div>
      {list === null ? (
        <p className="text-sm text-[var(--color-ink-soft)]">{t('support.loading')}</p>
      ) : list.length === 0 ? (
        <EmptyState title={t('support.emptyConversations')} body={t('support.emptyConversationsBody')} />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {list.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => void openOne(conversation.id)}
                className="grid w-full gap-1 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5 text-left hover:border-[var(--color-brand)]"
              >
                <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-soft)]">
                  <Badge tone={conversation.status === 'escalated' ? 'caution' : conversation.status === 'closed' ? 'neutral' : 'brand'}>
                    {t(`support.status.${conversation.status}` as MessageKey)}
                  </Badge>
                  <span>{categoryLabel(conversation.category)}</span>
                  <span>· {t('support.messages', { count: conversation.messageCount })}</span>
                  {conversation.satisfaction !== null ? <span>· {conversation.satisfaction > 0 ? '👍' : '👎'}</span> : null}
                  <span className="ml-auto">{new Date(conversation.lastMessageAt).toLocaleString(`${locale}-CH`)}</span>
                </span>
                <span className="truncate text-sm">{conversation.preview || t('support.noPreview')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TicketsView({
  base,
  t,
  locale,
  categoryLabel,
  setError,
  setNotice,
}: {
  base: string
  t: T
  locale: string
  categoryLabel: (c: string | null) => string
  setError: (e: string | null) => void
  setNotice: (n: string | null) => void
}) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await call<{ tickets: Ticket[] }>(`${base}/tickets`)
    if (!result.ok) setError(result.message)
    else setTickets(result.body.tickets)
  }, [base, setError])

  useEffect(() => {
    void load()
  }, [load])

  async function update(id: string, data: Partial<Pick<Ticket, 'status' | 'category' | 'priority'>>) {
    const result = await call(`${base}/tickets`, { method: 'PUT', body: JSON.stringify({ id, ...data }) })
    if (!result.ok) setError(result.message)
    else await load()
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (replyFor === null || reply.trim().length === 0) return
    setBusy(true)
    const result = await call<{ emailed: boolean }>(`${base}/tickets`, { method: 'POST', body: JSON.stringify({ id: replyFor, content: reply.trim() }) })
    setBusy(false)
    if (!result.ok) setError(result.message)
    else {
      setNotice(result.body.emailed ? t('support.replySent') : t('support.replySaved'))
      setReply('')
      setReplyFor(null)
      await load()
    }
  }

  if (tickets === null) return <p className="text-sm text-[var(--color-ink-soft)]">{t('support.loading')}</p>
  if (tickets.length === 0) return <EmptyState title={t('support.emptyTickets')} body={t('support.emptyTicketsBody')} />

  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {tickets.map((ticket) => (
        <li key={ticket.id} className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ticket.priority === 'high' ? 'critical' : ticket.priority === 'low' ? 'neutral' : 'brand'}>
              {t(`support.priority.${ticket.priority}` as MessageKey)}
            </Badge>
            <span className="text-sm font-medium">{ticket.subject}</span>
            <span className="ml-auto text-xs text-[var(--color-ink-soft)]">{new Date(ticket.createdAt).toLocaleString(`${locale}-CH`)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-soft)]">
            <span>{categoryLabel(ticket.category)}</span>
            {ticket.email !== null ? <span>· {ticket.email}</span> : null}
            <label className="ml-auto flex items-center gap-1">
              {t('support.statusLabel')}
              <Select value={ticket.status} onChange={(event) => void update(ticket.id, { status: event.target.value as Ticket['status'] })} className="py-1 text-xs">
                <option value="open">{t('support.ticket.open')}</option>
                <option value="in_progress">{t('support.ticket.in_progress')}</option>
                <option value="resolved">{t('support.ticket.resolved')}</option>
                <option value="closed">{t('support.ticket.closed')}</option>
              </Select>
            </label>
          </div>
          {replyFor === ticket.id ? (
            <form onSubmit={sendReply} className="grid gap-2">
              <Textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={3} placeholder={t('support.replyPlaceholder')} required />
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {t('support.reply')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setReplyFor(null)}>
                  {t('support.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button type="button" variant="secondary" onClick={() => setReplyFor(ticket.id)}>
                {t('support.reply')}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function KnowledgeView({
  base,
  t,
  locale,
  canWrite,
  faqCredits,
  busy,
  setBusy,
  setError,
  setNotice,
  onChanged,
}: {
  base: string
  t: T
  locale: string
  canWrite: boolean
  faqCredits: number
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setNotice: (n: string | null) => void
  onChanged: () => Promise<void>
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const result = await call<{ entries: Entry[] }>(`${base}/connaissances`)
    if (!result.ok) setError(result.message)
    else setEntries(result.body.entries)
  }, [base, setError])

  useEffect(() => {
    void load()
  }, [load])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      question: String(form.get('question') ?? ''),
      answer: String(form.get('answer') ?? ''),
      keywords: String(form.get('keywords') ?? ''),
      status: String(form.get('status') ?? 'draft'),
    }
    setBusy(true)
    const result =
      editing !== null
        ? await call(`${base}/connaissances`, { method: 'PUT', body: JSON.stringify({ id: editing.id, ...payload }) })
        : await call(`${base}/connaissances`, { method: 'POST', body: JSON.stringify({ action: 'create', ...payload }) })
    setBusy(false)
    if (!result.ok) setError(result.message)
    else {
      setEditing(null)
      setAdding(false)
      await load()
      await onChanged()
    }
  }

  async function setStatus(entry: Entry, status: Entry['status']) {
    const result = await call(`${base}/connaissances`, { method: 'PUT', body: JSON.stringify({ id: entry.id, status }) })
    if (!result.ok) setError(result.message)
    else {
      await load()
      await onChanged()
    }
  }

  async function remove(entry: Entry) {
    if (!window.confirm(t('support.confirmDeleteEntry'))) return
    const result = await call(`${base}/connaissances`, { method: 'DELETE', body: JSON.stringify({ id: entry.id }) })
    if (!result.ok) setError(result.message)
    else {
      await load()
      await onChanged()
    }
  }

  async function generate() {
    setBusy(true)
    setError(null)
    const result = await call<{ entries: Entry[]; creditsSpent: number }>(`${base}/connaissances`, {
      method: 'POST',
      body: JSON.stringify({ action: 'generate', locale }),
    })
    setBusy(false)
    if (!result.ok) setError(result.message)
    else {
      setEntries(result.body.entries)
      setNotice(t('support.generated', { count: result.body.creditsSpent }))
      await onChanged()
    }
  }

  const form = (entry: Entry | null) => (
    <form onSubmit={save} className="grid gap-3 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3">
      <Field label={t('support.field.question')}>
        <Input name="question" defaultValue={entry?.question ?? ''} required maxLength={200} />
      </Field>
      <Field label={t('support.field.answer')} hint={t('support.field.answerHint')}>
        <Textarea name="answer" defaultValue={entry?.answer ?? ''} required rows={4} maxLength={1500} />
      </Field>
      <Field label={t('support.field.keywords')} hint={t('support.field.keywordsHint')}>
        <Input name="keywords" defaultValue={entry?.keywords ?? ''} maxLength={300} />
      </Field>
      <Field label={t('support.field.status')}>
        <Select name="status" defaultValue={entry?.status ?? 'draft'}>
          <option value="draft">{t('support.entry.draft')}</option>
          <option value="published">{t('support.entry.published')}</option>
          <option value="disabled">{t('support.entry.disabled')}</option>
        </Select>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {t('support.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setEditing(null)
            setAdding(false)
          }}
        >
          {t('support.cancel')}
        </Button>
      </div>
    </form>
  )

  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-[var(--color-ink-soft)]">{t('support.knowledgeHint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!canWrite || busy} onClick={() => setAdding(true)}>
          {t('support.addEntry')}
        </Button>
        <Button type="button" disabled={!canWrite || busy} onClick={() => void generate()}>
          {busy ? t('support.generating') : `${t('support.generate')} · ${faqCredits}`}
        </Button>
      </div>
      {adding ? form(null) : null}
      {entries === null ? (
        <p className="text-sm text-[var(--color-ink-soft)]">{t('support.loading')}</p>
      ) : entries.length === 0 ? (
        <EmptyState title={t('support.emptyKnowledge')} body={t('support.emptyKnowledgeBody')} />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5">
              {editing?.id === entry.id ? (
                form(entry)
              ) : (
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={entry.status === 'published' ? 'positive' : entry.status === 'draft' ? 'caution' : 'neutral'}>
                      {t(`support.entry.${entry.status}` as MessageKey)}
                    </Badge>
                    {entry.kind === 'generated' ? <span className="text-xs text-[var(--color-ink-faint)]">{t('support.generatedTag')}</span> : null}
                    <span className="ml-auto flex gap-2 text-xs">
                      {entry.status !== 'published' ? (
                        <button type="button" className="text-[var(--color-brand-strong)]" onClick={() => void setStatus(entry, 'published')}>
                          {t('support.publish')}
                        </button>
                      ) : (
                        <button type="button" className="text-[var(--color-ink-soft)]" onClick={() => void setStatus(entry, 'disabled')}>
                          {t('support.disable')}
                        </button>
                      )}
                      <button type="button" className="text-[var(--color-ink-soft)]" onClick={() => setEditing(entry)}>
                        {t('support.edit')}
                      </button>
                      <button type="button" className="text-[var(--color-ink-soft)]" onClick={() => void remove(entry)}>
                        {t('support.delete')}
                      </button>
                    </span>
                  </div>
                  <p className="m-0 text-sm font-medium">{entry.question}</p>
                  <p className="m-0 whitespace-pre-line text-sm text-[var(--color-ink-soft)]">{entry.answer}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SettingsView({
  base,
  t,
  settings,
  canEnable,
  busy,
  setBusy,
  setError,
  setNotice,
  onSaved,
}: {
  base: string
  t: T
  settings: Settings
  canEnable: boolean
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setNotice: (n: string | null) => void
  onSaved: () => Promise<void>
}) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const accent = String(form.get('accentColor') ?? '').trim()
    const email = String(form.get('escalationEmail') ?? '').trim()
    setBusy(true)
    setError(null)
    const result = await call(base, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: form.get('enabled') === 'on',
        displayName: String(form.get('displayName') ?? ''),
        greeting: String(form.get('greeting') ?? ''),
        position: String(form.get('position') ?? 'bottom-right'),
        accentColor: accent === '' ? null : accent,
        escalationEmail: email === '' ? null : email,
        retentionDays: Number(form.get('retentionDays') ?? 90),
      }),
    })
    setBusy(false)
    if (!result.ok) setError(result.message)
    else {
      setNotice(t('support.settingsSaved'))
      await onSaved()
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={!canEnable && !settings.enabled} className="mt-1" />
        <span>
          <span className="font-medium">{t('support.enable')}</span>
          <span className="block text-[var(--color-ink-soft)]">{t('support.enableHint')}</span>
        </span>
      </label>
      <Field label={t('support.field.displayName')}>
        <Input name="displayName" defaultValue={settings.displayName} required maxLength={40} />
      </Field>
      <Field label={t('support.field.greeting')}>
        <Textarea name="greeting" defaultValue={settings.greeting} required rows={2} maxLength={300} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('support.field.position')}>
          <Select name="position" defaultValue={settings.position}>
            <option value="bottom-right">{t('support.position.right')}</option>
            <option value="bottom-left">{t('support.position.left')}</option>
          </Select>
        </Field>
        <Field label={t('support.field.accentColor')} hint={t('support.field.accentColorHint')}>
          <Input name="accentColor" defaultValue={settings.accentColor ?? ''} placeholder="#9705f4" pattern="^#[0-9a-fA-F]{6}$" />
        </Field>
        <Field label={t('support.field.escalationEmail')} hint={t('support.field.escalationEmailHint')}>
          <Input name="escalationEmail" type="email" defaultValue={settings.escalationEmail ?? ''} />
        </Field>
        <Field label={t('support.field.retentionDays')} hint={t('support.field.retentionDaysHint')}>
          <Input name="retentionDays" type="number" min={7} max={365} defaultValue={settings.retentionDays} />
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {t('support.save')}
        </Button>
      </div>
    </form>
  )
}

function InsightsView({
  base,
  t,
  locale,
  credits,
  canRun,
  busy,
  setBusy,
  setError,
  setNotice,
  onSendToBuilder,
}: {
  base: string
  t: T
  locale: string
  credits: number
  canRun: boolean
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setNotice: (n: string | null) => void
  onSendToBuilder: (text: string) => void
}) {
  const [insights, setInsights] = useState<Insight[] | null>(null)

  const load = useCallback(async () => {
    const result = await call<{ insights: Insight[] }>(`${base}/analyses`)
    if (!result.ok) setError(result.message)
    else setInsights(result.body.insights)
  }, [base, setError])

  useEffect(() => {
    void load()
  }, [load])

  async function run() {
    setBusy(true)
    setError(null)
    const result = await call<{ insights: Insight[]; analyzed: number; creditsSpent: number }>(`${base}/analyses`, {
      method: 'POST',
      body: JSON.stringify({ locale }),
    })
    setBusy(false)
    if (!result.ok) setError(result.message)
    else {
      setInsights(result.body.insights)
      setNotice(t('support.analyzed', { count: result.body.analyzed }))
    }
  }

  async function setStatus(id: string, status: Insight['status']) {
    const result = await call(`${base}/analyses`, { method: 'PUT', body: JSON.stringify({ id, status }) })
    if (!result.ok) setError(result.message)
    else await load()
  }

  const tone = (kind: Insight['kind']) => (kind === 'potential_bug' ? 'critical' : kind === 'feature_request' ? 'brand' : kind === 'unanswered' ? 'caution' : 'neutral')

  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-[var(--color-ink-soft)]">{t('support.insightsHint')}</p>
      <div>
        <Button type="button" disabled={!canRun || busy} onClick={() => void run()}>
          {busy ? t('support.analyzing') : `${t('support.analyze')} · ${credits}`}
        </Button>
      </div>
      {insights === null ? (
        <p className="text-sm text-[var(--color-ink-soft)]">{t('support.loading')}</p>
      ) : insights.length === 0 ? (
        <EmptyState title={t('support.emptyInsights')} body={t('support.emptyInsightsBody')} />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {insights.map((insight) => (
            <li key={insight.id} className={`grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5 ${insight.status === 'dismissed' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone(insight.kind)}>{t(`support.kind.${insight.kind}` as MessageKey)}</Badge>
                <span className="text-sm font-medium">{insight.title}</span>
                <span className="ml-auto text-xs text-[var(--color-ink-soft)]">{t('support.requests', { count: insight.count })}</span>
              </div>
              {insight.examples.length > 0 ? (
                <ul className="m-0 list-disc pl-5 text-xs text-[var(--color-ink-soft)]">
                  {insight.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              ) : null}
              <p className="m-0 text-xs text-[var(--color-ink-faint)]">{t('support.insightDisclaimer')}</p>
              <div className="flex flex-wrap gap-2">
                {insight.status !== 'roadmap' ? (
                  <Button type="button" variant="secondary" onClick={() => void setStatus(insight.id, 'roadmap')}>
                    {t('support.toRoadmap')}
                  </Button>
                ) : (
                  <Badge tone="positive">{t('support.onRoadmap')}</Badge>
                )}
                <Button type="button" variant="secondary" onClick={() => onSendToBuilder(builderRequestFor(insight))}>
                  {t('support.toBuilder')}
                </Button>
                {insight.status !== 'dismissed' ? (
                  <Button type="button" variant="ghost" onClick={() => void setStatus(insight.id, 'dismissed')}>
                    {t('support.dismiss')}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
