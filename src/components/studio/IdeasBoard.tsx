'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardBody, EmptyState, Notice } from '@/components/ui'
import {
  formatMoney,
  formatPrice,
  MODEL_LABEL,
  scoreTone,
  type BoardIdea,
} from './idea-types'

/**
 * Étape 3 du parcours : les idées proposées.
 *
 * Cet écran sert à **comparer et choisir**, pas à tout lire. Chaque carte tient en un coup
 * d'œil : score, prix, clients nécessaires, difficulté, délai, coût de fonctionnement.
 * Le détail complet vit sur la fiche d'étude, une page plus loin.
 */
export function IdeasBoard({
  locale,
  initialIdeas,
  objectiveLabel,
  aiAvailable,
}: {
  locale: string
  initialIdeas: BoardIdea[]
  objectiveLabel: string
  aiAvailable: boolean
}) {
  const [ideas, setIdeas] = useState(initialIdeas)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function propose() {
    setBusy('propose')
    setError(null)
    const response = await fetch('/api/idees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    const body = (await response.json()) as { ideas?: BoardIdea[]; message?: string }
    setBusy(null)
    if (!response.ok || body.ideas === undefined) {
      setError(body.message ?? "La recherche d'idées n'a pas abouti.")
      return
    }
    setIdeas([...body.ideas, ...ideas])
  }

  async function discard(ideaId: string) {
    setBusy(ideaId)
    await fetch(`/api/idees/${ideaId}/ecarter`, { method: 'POST' })
    setBusy(null)
    setIdeas((current) => current.filter((idea) => idea.id !== ideaId))
  }

  return (
    <div className="grid gap-5">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4">
          <div>
            <p className="m-0 text-sm text-[var(--color-ink-soft)]">Votre objectif</p>
            <p className="m-0 text-xl font-semibold">{objectiveLabel}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <a href={`/${locale}/objectif`} className="text-sm text-[var(--color-brand)]">
              Modifier
            </a>
            <Button onClick={() => void propose()} disabled={busy !== null || !aiAvailable}>
              {busy === 'propose' ? 'Recherche…' : 'Proposer des idées'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {!aiAvailable ? (
        <Notice tone="caution" title="Copilote non configuré">
          Cette installation n&apos;a pas d&apos;accès au copilote. La recherche
          d&apos;idées ne peut pas fonctionner. Vous pouvez tout de même décrire vous-même
          une idée depuis <a href={`/${locale}/creer`}>cette page</a>.
        </Notice>
      ) : null}

      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      {ideas.length === 0 ? (
        <EmptyState
          title="Aucune idée pour le moment"
          body="Lancez une recherche : nous vous proposons des idées adaptées à votre objectif, à votre temps disponible et à ce que vous savez faire."
          action={
            <Button
              size="large"
              onClick={() => void propose()}
              disabled={busy !== null || !aiAvailable}
            >
              {busy === 'propose' ? 'Recherche…' : 'Proposer des idées'}
            </Button>
          }
        />
      ) : null}

      {ideas.map((idea) => (
        <Card key={idea.id}>
          <CardBody>
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-lg font-semibold">{idea.title}</h2>
                <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">
                  {idea.valueProposition}
                </p>
              </div>
              <div className="text-center">
                <p className="m-0 text-3xl font-semibold leading-none">{idea.opportunityScore}</p>
                <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">potentiel sur 100</p>
              </div>
            </div>

            <dl className="mt-5 grid gap-3 sm:grid-cols-4">
              <Figure label="Difficulté" value={idea.complexityLevel} />
              <Figure
                label="Prix conseillé"
                value={formatPrice(idea.recommendedPriceCents, idea.priceInterval, idea.currency)}
              />
              <Figure
                label="Clients pour votre objectif"
                value={
                  idea.comparableToObjective && idea.customersNeeded > 0
                    ? `environ ${idea.customersNeeded}`
                    : '—'
                }
              />
              <Figure
                label="Coût de fonctionnement"
                value={
                  idea.runningCostCents > 0
                    ? `${formatMoney(idea.runningCostCents, idea.currency)} par mois`
                    : 'proche de zéro'
                }
              />
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={scoreTone(idea.opportunityScore)}>
                Potentiel {idea.opportunityScore}/100
              </Badge>
              <Badge>Concurrence {idea.competitionLevel}</Badge>
              <Badge>Demande {idea.demandLevel}</Badge>
              <Badge>{MODEL_LABEL[idea.businessModel] ?? idea.businessModel}</Badge>
              <Badge>Prêt en {idea.timeToMarketWeeks} semaine(s)</Badge>
              {idea.projectId !== null ? <Badge tone="positive">Application créée</Badge> : null}
              {idea.specSheet !== null && idea.projectId === null ? (
                <Badge tone="brand">Cahier des charges prêt</Badge>
              ) : null}
              {idea.validation !== null && idea.specSheet === null ? (
                <Badge tone="brand">Étudiée</Badge>
              ) : null}
            </div>

            <p className="mt-4 text-sm text-[var(--color-ink-soft)]">{idea.objectiveSentence}</p>

            <div className="mt-5 flex flex-wrap gap-3">
              {idea.projectId !== null ? (
                <a
                  href={`/${locale}/projets/${idea.projectId}`}
                  className="inline-flex items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white no-underline"
                >
                  Ouvrir mon application
                </a>
              ) : (
                <>
                  <a
                    href={`/${locale}/idees/${idea.id}`}
                    className="inline-flex items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white no-underline"
                  >
                    Étudier cette idée
                  </a>
                  <Button
                    variant="ghost"
                    onClick={() => void discard(idea.id)}
                    disabled={busy !== null}
                  >
                    Écarter
                  </Button>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="m-0 text-xs text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  )
}
