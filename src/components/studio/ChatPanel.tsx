'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Notice, Textarea } from '@/components/ui'
import { PHOTO_ACCEPT } from '@/lib/photo-upload'

/**
 * Une image jointe à la demande en cours.
 *
 * Elle est déjà envoyée et déjà traitée : ce qui reste ici est ce qu'il faut pour
 * l'afficher et la désigner. Au moment d'envoyer, seuls les identifiants partent.
 */
type Jointe = { id: string; filename: string }

/** Au-delà, une demande cesse d'être « place cette photo » et devient un album. */
const MAX_JOINTES = 4

type Message = {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  /** Ce que l'agent a fait pour répondre. Absent des messages relus depuis la base. */
  trace?: Trace
  /** Présent quand la modification attend votre décision. */
  plan?: Plan
}

/**
 * Une modification préparée, qui attend d'être appliquée.
 *
 * Elle n'est pas une intention : le travail est fait et validé, il attend simplement. D'où
 * le vocabulaire de l'encadré — « voici ce que je propose », pas « voici ce que je ferais ».
 * Et d'où le fait qu'appliquer ne coûte aucun crédit : c'est déjà payé.
 */
type Plan = {
  id: string
  summary: string
  reasons: string[]
  targets: string[]
  scale: { operations: number; pages: number; models: number; deletions: number }
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
  const [deciding, setDeciding] = useState<string | null>(null)
  const [jointes, setJointes] = useState<Jointe[]>([])
  const [envoiImage, setEnvoiImage] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fichier = useRef<HTMLInputElement>(null)

  // On fait défiler le conteneur de la conversation, jamais la page : `scrollIntoView`
  // ferait remonter toute la fenêtre et chasserait l'aperçu hors de l'écran.
  useEffect(() => {
    if (initialDraft !== '') setDraft(initialDraft)
  }, [initialDraft])

  useEffect(() => {
    const container = scrollRef.current
    if (container !== null) container.scrollTop = container.scrollHeight
  }, [messages.length, busy])

  /**
   * Joindre une image.
   *
   * Elle part par le même chemin que l'écran Images, et pour une raison de fond : ce n'est
   * pas une pièce jointe de messagerie, c'est une image du projet. Elle rejoint donc la
   * bibliothèque, passe par le même traitement — identification par les octets,
   * ré-encodage, quota de l'offre — et reste disponible ensuite, même si la demande
   * n'aboutit pas. Un second dépôt réservé à la conversation finirait par accepter ce que
   * l'autre refuse, et laisserait des images que rien ne montre.
   */
  async function joindre(files: FileList | null) {
    if (files === null || files.length === 0 || envoiImage) return
    setEnvoiImage(true)
    setError(null)
    try {
      for (const file of Array.from(files).slice(0, MAX_JOINTES - jointes.length)) {
        const corps = new FormData()
        corps.append('image', file)
        const response = await fetch(`/api/projects/${projectId}/medias`, {
          method: 'POST',
          body: corps,
        })
        const body = (await response.json().catch(() => null)) as {
          media?: { id: string; filename: string }
          message?: string
        } | null
        if (body === null || !response.ok || body.media === undefined) {
          setError(body?.message ?? "Cette image n'a pas pu être ajoutée.")
          break
        }
        const ajoutee = body.media
        setJointes((current) =>
          current.some((image) => image.id === ajoutee.id) ? current : [...current, ajoutee],
        )
      }
    } catch {
      setError("L'envoi de l'image a échoué. Vérifiez votre connexion.")
    } finally {
      setEnvoiImage(false)
    }
  }

  async function send() {
    const message = draft.trim()
    if (message.length < 3 || busy) return

    const mediaIds = jointes.map((image) => image.id)
    const noms = jointes.map((image) => image.filename).join(', ')

    setBusy(true)
    setError(null)
    setDraft('')
    setJointes([])
    setMessages((current) => [
      ...current,
      {
        id: `local-${current.length}`,
        role: 'USER',
        // Le même texte que celui gardé par le serveur : la conversation ne doit pas dire
        // autre chose une fois rechargée.
        content: noms === '' ? message : `${message}\n\n(Image${jointes.length > 1 ? 's' : ''} jointe${jointes.length > 1 ? 's' : ''} : ${noms})`,
      },
    ])

    const response = await fetch(`/api/projects/${projectId}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, mediaIds }),
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
      plan?: Plan
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
        ...(body.plan === undefined ? {} : { plan: body.plan }),
      },
    ])
    setBusy(false)
    if (body.applied === true) onApplied()
  }

  /** Applique ou abandonne une modification annoncée. Aucun crédit n'est engagé ici. */
  async function decide(plan: Plan, action: 'apply' | 'cancel') {
    if (deciding !== null) return
    setDeciding(plan.id)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: plan.id, action }),
    })
    const body = (await response.json().catch(() => null)) as {
      reply?: string
      applied?: boolean
      message?: string
    } | null
    setDeciding(null)
    if (body === null || !response.ok) {
      setError(body?.message ?? "La décision n'a pas abouti.")
      return
    }
    // L'encadré disparaît : la proposition n'est plus en attente, quelle que soit l'issue.
    setMessages((current) => [
      ...current.map((item) => (item.id === plan.id ? { ...item, plan: undefined } : item)),
      { id: `decision-${current.length}`, role: 'ASSISTANT', content: body.reply ?? '' },
    ])
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
              {message.plan !== undefined ? (
                <PlanCard
                  plan={message.plan}
                  busy={deciding === message.plan.id}
                  onDecide={(action) => void decide(message.plan!, action)}
                  onEdit={() => {
                    setDraft(draftFromPlan(message.plan!))
                    void decide(message.plan!, 'cancel')
                  }}
                />
              ) : null}
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

        {jointes.length > 0 ? (
          <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
            {jointes.map((image) => (
              <li
                key={image.id}
                className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] py-1 pl-1 pr-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- image servie par la base, sans dimensions connues d'avance */}
                <img
                  src={`/api/app/${projectId}/medias/${image.id}?format=thumb`}
                  alt=""
                  className="h-8 w-8 rounded-[var(--radius-control)] object-cover"
                />
                <span className="max-w-32 truncate text-xs">{image.filename}</span>
                <button
                  type="button"
                  onClick={() => setJointes((current) => current.filter((autre) => autre.id !== image.id))}
                  aria-label={`Retirer ${image.filename}`}
                  className="text-xs text-[var(--color-ink-soft)]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <input
          ref={fichier}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            void joindre(event.target.files)
            // Remis à zéro : sans cela, rechoisir le même fichier ne déclencherait rien.
            event.target.value = ''
          }}
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fichier.current?.click()}
            disabled={busy || envoiImage || jointes.length >= MAX_JOINTES}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-sm text-[var(--color-ink-soft)] disabled:opacity-50"
          >
            {envoiImage ? 'Envoi…' : '📎 Image'}
          </button>
          <Button className="flex-1" onClick={() => void send()} disabled={busy}>
            {busy ? '…' : 'Envoyer'}
          </Button>
        </div>
        {jointes.length > 0 ? (
          <p className="m-0 mt-2 text-xs text-[var(--color-ink-faint)]">
            L’assistant ne regarde pas vos images : il en connaît le nom et la taille, et sait
            où les placer. Dites-lui où vous les voulez. Elles rejoignent votre bibliothèque,
            onglet Images.
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Le texte remis dans la zone de saisie quand on choisit « Modifier la demande ».
 *
 * On ne remet pas la demande d'origine : elle a produit ce plan-là, la retaper à
 * l'identique produirait le même. On propose un point de départ qui dit à l'agent ce qu'on
 * veut changer dans sa proposition.
 */
function draftFromPlan(plan: Plan): string {
  return `${plan.summary} — mais `
}

/** « 9 modifications · 2 pages · vos données ». Rien d'inventé : ce que le plan touche. */
function describeScale(plan: Plan): string {
  const morceaux = [
    `${plan.scale.operations} modification${plan.scale.operations > 1 ? 's' : ''}`,
  ]
  if (plan.scale.pages > 0) morceaux.push(`${plan.scale.pages} page${plan.scale.pages > 1 ? 's' : ''}`)
  if (plan.scale.models > 0) morceaux.push('vos données')
  if (plan.scale.deletions > 0) {
    morceaux.push(`${plan.scale.deletions} suppression${plan.scale.deletions > 1 ? 's' : ''}`)
  }
  return morceaux.join(' · ')
}

/**
 * L'encadré d'une modification annoncée.
 *
 * Il dit trois choses, dans cet ordre : que rien n'est encore appliqué, ce que la
 * modification touche, et pourquoi elle est soumise à décision. L'ordre compte — un
 * créateur qui lit « rien n'est encore appliqué » en premier lit la suite tranquillement.
 */
function PlanCard({
  plan,
  busy,
  onDecide,
  onEdit,
}: {
  plan: Plan
  busy: boolean
  onDecide: (action: 'apply' | 'cancel') => void
  onEdit: () => void
}) {
  return (
    <div
      className="justify-self-start max-w-[90%] rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 text-sm"
      role="group"
      aria-label="Modification à confirmer"
    >
      <p className="m-0 font-medium">Rien n’est encore appliqué.</p>
      {plan.targets.length > 0 ? (
        <p className="mt-1 mb-0 text-[var(--color-ink-soft)]">
          Cette modification touche {plan.targets.join(', ')}.
        </p>
      ) : null}
      {plan.reasons.length > 0 ? (
        <>
          <p className="mt-2 mb-0 text-[var(--color-ink-soft)]">Je vous demande votre avis parce que :</p>
          <ul className="mt-1 mb-0 list-disc pl-5 text-[var(--color-ink-soft)]">
            {plan.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">{describeScale(plan)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => onDecide('apply')}>
          {busy ? '…' : 'Appliquer'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onEdit}>
          Modifier la demande
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onDecide('cancel')}>
          Annuler
        </Button>
      </div>
      <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">
        Appliquer ne coûte aucun crédit : le travail est déjà fait.
      </p>
    </div>
  )
}
