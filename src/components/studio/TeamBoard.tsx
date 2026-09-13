'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardBody, Notice, Textarea } from '@/components/ui'

/**
 * Le bureau des trois spécialistes.
 *
 * Trois partis pris.
 *
 * **On choisit son interlocuteur.** Un guichet unique qui devine à qui s'adresser se
 * trompe, et fait payer son erreur. Trois portes nommées coûtent un clic et n'échouent
 * jamais.
 *
 * **Le coût est annoncé avant la question, pas découvert après.** Le solde et le prix sont
 * à l'écran, sur le bouton même.
 *
 * **Un spécialiste fermé s'affiche quand même**, avec l'offre qui l'ouvrirait. Le masquer
 * laisserait croire qu'il n'existe pas ; le griser sans rien dire serait une impasse.
 */

export type AgentState = {
  id: string
  name: string
  role: string
  summary: string
  starters: string[]
  open: boolean
  availableWith: string | null
}

export type NoteState = {
  id: string
  agent: string
  agentName: string
  question: string
  answer: string
  creditsSpent: number
  createdAt: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function TeamBoard({
  projectId,
  agents,
  initialNotes,
  credits,
  estimatedCredits,
  teamEnabled,
}: {
  projectId: string
  agents: AgentState[]
  initialNotes: NoteState[]
  credits: number
  estimatedCredits: number
  /** L'offre relie les spécialistes entre eux : chacun reçoit ce que les autres ont retenu. */
  teamEnabled: boolean
}) {
  const premierOuvert = agents.find((agent) => agent.open)
  const [selected, setSelected] = useState<string>(premierOuvert?.id ?? agents[0]?.id ?? '')
  const [question, setQuestion] = useState('')
  const [notes, setNotes] = useState(initialNotes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agent = agents.find((candidate) => candidate.id === selected)
  const conversation = notes.filter((note) => note.agent === selected)
  const assezDeCredits = credits >= estimatedCredits

  async function envoyer() {
    if (agent === undefined || question.trim().length < 3) return
    setBusy(true)
    setError(null)

    // Les deux derniers échanges suffisent à garder le fil sans gonfler le coût.
    const history = conversation
      .slice(0, 2)
      .reverse()
      .map((note) => ({ question: note.question, answer: note.answer }))

    const response = await fetch(`/api/projects/${projectId}/equipe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: agent.id, question: question.trim(), history }),
    })
    const body = (await response.json()) as { message?: string; note?: NoteState }
    setBusy(false)

    if (!response.ok || body.note === undefined) {
      setError(body.message ?? "La question n'a pas abouti.")
      return
    }
    setNotes((anciennes) => [body.note as NoteState, ...anciennes])
    setQuestion('')
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        {agents.map((candidate) => {
          const actif = candidate.id === selected
          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setSelected(candidate.id)}
              className={`rounded-[var(--radius-card)] border p-5 text-left transition ${
                actif
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                  : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-brand)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-semibold">{candidate.name}</span>
                {candidate.open ? null : <Badge tone="neutral">Fermé</Badge>}
              </div>
              <p className="m-0 mt-0.5 text-xs text-[var(--color-ink-faint)]">{candidate.role}</p>
              <p className="m-0 mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {candidate.summary}
              </p>
            </button>
          )
        })}
      </div>

      {agent === undefined ? null : agent.open ? (
        <Card>
          <CardBody className="grid gap-4">
            <div>
              <h2 className="m-0 text-lg font-semibold">
                Poser une question à {agent.name}
              </h2>
              <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">
                {agent.name} ne lit que les faits réels de ce projet. S’il manque une donnée,
                il le dit plutôt que de la deviner.
              </p>
            </div>

            {conversation.length === 0 ? (
              <div className="grid gap-2">
                <p className="m-0 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                  Par exemple
                </p>
                <div className="flex flex-wrap gap-2">
                  {agent.starters.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => setQuestion(starter)}
                      className="rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand-strong)]"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              maxLength={600}
              placeholder={`Votre question à ${agent.name}`}
              aria-label={`Votre question à ${agent.name}`}
            />

            {error === null ? null : <Notice tone="critical">{error}</Notice>}
            {assezDeCredits ? null : (
              <Notice tone="caution">
                Il vous reste {credits} crédits. Une question en coûte environ{' '}
                {estimatedCredits}.
              </Notice>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={envoyer}
                disabled={busy || question.trim().length < 3 || !assezDeCredits}
              >
                {busy ? 'Un instant…' : `Poser la question · ${estimatedCredits} crédits`}
              </Button>
              <span className="text-sm text-[var(--color-ink-faint)]">
                {teamEnabled
                  ? 'Vos trois spécialistes partagent ce qu’ils retiennent.'
                  : 'Chaque spécialiste répond seul. Les relier entre eux demande une offre supérieure.'}
              </span>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="grid gap-3">
            <h2 className="m-0 text-lg font-semibold">{agent.name} n’est pas dans votre offre</h2>
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">{agent.summary}</p>
            <Notice tone="neutral">
              {agent.availableWith === null
                ? "Ce spécialiste n'est pas inclus dans votre offre actuelle."
                : `Disponible avec l'offre ${agent.availableWith}.`}
            </Notice>
          </CardBody>
        </Card>
      )}

      {conversation.length === 0 ? null : (
        <div className="grid gap-3">
          <h2 className="m-0 text-lg font-semibold">Ce que {agent?.name} vous a répondu</h2>
          {conversation.map((note) => (
            <Card key={note.id}>
              <CardBody className="grid gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 font-medium">{note.question}</p>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {formatDate(note.createdAt)} · {note.creditsSpent} crédits
                  </span>
                </div>
                <p className="m-0 whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {note.answer}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
