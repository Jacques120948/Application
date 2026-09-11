'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, Card, CardBody, EmptyState, Notice } from '@/components/ui'

/**
 * Écran « trouver une idée ».
 *
 * C'est ici que le produit se distingue d'un générateur d'applications : l'utilisateur ne
 * décrit rien, il compare des propositions chiffrées et choisit. Chaque idée affiche ce
 * qu'il faut pour décider : score, prix conseillé, nombre de clients correspondant à son
 * objectif, difficulté, délai.
 */

type Level = 'faible' | 'moyen' | 'fort'

type Validation = {
  opportunityScore: number
  marketSize: string
  problemAssessment: string
  audienceAssessment: string
  competitors: Array<{ name: string; note: string }>
  essentialFeatures: string[]
  featuresToAvoid: string[]
  pricingRationale: string
  acquisitionDifficulty: Level
  acquisitionChannels: string[]
  risks: Array<{ risk: string; mitigation: string }>
  differentiators: string[]
  externalServices: Array<{ name: string; why: string; paid: boolean }>
  verdict: 'a-lancer' | 'a-ajuster' | 'a-eviter'
  verdictReason: string
}

export type BoardIdea = {
  id: string
  title: string
  problem: string
  audience: string
  valueProposition: string
  features: string[]
  businessModel: string
  recommendedPriceCents: number
  priceInterval: 'once' | 'month' | 'year'
  opportunityScore: number
  demandLevel: string
  competitionLevel: string
  complexityLevel: string
  operatingCostLevel: string
  timeToMarketWeeks: number
  customersNeeded: number
  risks: string[]
  differentiators: string[]
  status: 'PROPOSED' | 'SELECTED' | 'DISCARDED'
  objectiveSentence: string
  validation: Validation | null
  projectId: string | null
}

const MODEL_LABEL: Record<string, string> = {
  one_time: 'Achat unique',
  subscription: 'Abonnement',
  freemium: 'Gratuit puis payant',
  credits: 'Crédits',
  free: 'Gratuit',
}

const VERDICT: Record<Validation['verdict'], { label: string; tone: 'positive' | 'caution' | 'critical' }> = {
  'a-lancer': { label: 'À lancer', tone: 'positive' },
  'a-ajuster': { label: 'À ajuster avant de lancer', tone: 'caution' },
  'a-eviter': { label: 'Mieux vaut chercher autre chose', tone: 'critical' },
}

function scoreTone(score: number): 'positive' | 'caution' | 'critical' {
  if (score >= 70) return 'positive'
  if (score >= 45) return 'caution'
  return 'critical'
}

function formatPrice(cents: number, interval: BoardIdea['priceInterval']): string {
  if (cents <= 0) return 'Gratuit'
  const amount = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
  if (interval === 'month') return `${amount} par mois`
  if (interval === 'year') return `${amount} par an`
  return `${amount} une fois`
}

export function IdeasBoard({
  locale,
  initialIdeas,
  objectiveLabel,
  canBuild,
  aiAvailable,
}: {
  locale: string
  initialIdeas: BoardIdea[]
  objectiveLabel: string
  canBuild: boolean
  aiAvailable: boolean
}) {
  const router = useRouter()
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

  async function analyse(ideaId: string) {
    setBusy(ideaId)
    setError(null)
    const response = await fetch(`/api/idees/${ideaId}/analyse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    const body = (await response.json()) as { idea?: BoardIdea; message?: string }
    setBusy(null)
    if (!response.ok || body.idea === undefined) {
      setError(body.message ?? "L'analyse n'a pas abouti.")
      return
    }
    const analysed = body.idea
    setIdeas((current) => current.map((idea) => (idea.id === analysed.id ? analysed : idea)))
  }

  async function build(ideaId: string) {
    setBusy(ideaId)
    setError(null)
    const response = await fetch(`/api/idees/${ideaId}/construire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    const body = (await response.json()) as { projectId?: string; message?: string }
    setBusy(null)
    if (!response.ok || body.projectId === undefined) {
      setError(body.message ?? "La création n'a pas abouti.")
      return
    }
    router.push(`/${locale}/projets/${body.projectId}`)
    router.refresh()
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
          Cette installation n&apos;a pas d&apos;accès au copilote. La recherche d&apos;idées
          ne peut pas fonctionner. Vous pouvez tout de même décrire vous-même une idée
          depuis <a href={`/${locale}/creer`}>cette page</a>.
        </Notice>
      ) : null}

      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      {ideas.length === 0 ? (
        <EmptyState
          title="Aucune idée pour le moment"
          body="Lancez une recherche : nous vous proposons des idées adaptées à votre objectif, à votre temps disponible et à ce que vous savez faire."
          action={
            <Button size="large" onClick={() => void propose()} disabled={busy !== null || !aiAvailable}>
              {busy === 'propose' ? 'Recherche…' : 'Proposer des idées'}
            </Button>
          }
        />
      ) : null}

      {ideas.map((idea) => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          locale={locale}
          canBuild={canBuild}
          busy={busy === idea.id}
          disabled={busy !== null}
          onAnalyse={() => void analyse(idea.id)}
          onBuild={() => void build(idea.id)}
          onDiscard={() => void discard(idea.id)}
        />
      ))}
    </div>
  )
}

function IdeaCard({
  idea,
  locale,
  canBuild,
  busy,
  disabled,
  onAnalyse,
  onBuild,
  onDiscard,
}: {
  idea: BoardIdea
  locale: string
  canBuild: boolean
  busy: boolean
  disabled: boolean
  onAnalyse: () => void
  onBuild: () => void
  onDiscard: () => void
}) {
  const [open, setOpen] = useState(idea.validation !== null)

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-lg font-semibold">{idea.title}</h2>
            <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">{idea.valueProposition}</p>
          </div>
          <div className="text-center">
            <p className="m-0 text-3xl font-semibold leading-none">{idea.opportunityScore}</p>
            <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">sur 100</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone={scoreTone(idea.opportunityScore)}>
            Opportunité {idea.opportunityScore}/100
          </Badge>
          <Badge>Demande {idea.demandLevel}</Badge>
          <Badge>Concurrence {idea.competitionLevel}</Badge>
          <Badge>Difficulté {idea.complexityLevel}</Badge>
          <Badge>Coûts {idea.operatingCostLevel}</Badge>
          <Badge>Environ {idea.timeToMarketWeeks} semaine(s)</Badge>
          {idea.projectId !== null ? <Badge tone="positive">Application créée</Badge> : null}
        </div>

        <dl className="mt-5 grid gap-2 text-sm">
          <Row label="Problème résolu" value={idea.problem} />
          <Row label="Pour qui" value={idea.audience} />
          <Row label="Modèle" value={MODEL_LABEL[idea.businessModel] ?? idea.businessModel} />
          <Row
            label="Prix conseillé"
            value={formatPrice(idea.recommendedPriceCents, idea.priceInterval)}
          />
        </dl>

        <div className="mt-4 rounded-[var(--radius-card)] bg-[var(--color-brand-soft)] px-4 py-3">
          <p className="m-0 text-sm font-medium text-[var(--color-brand-strong)]">
            {idea.customersNeeded > 0
              ? `Environ ${idea.customersNeeded} client(s) pour votre objectif`
              : 'Cette idée ne génère pas directement de chiffre d’affaires'}
          </p>
          <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">{idea.objectiveSentence}</p>
        </div>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-4 text-sm text-[var(--color-brand)]"
        >
          {open ? 'Masquer le détail' : 'Voir le détail'}
        </button>

        {open ? (
          <div className="mt-4 grid gap-4">
            <List title="Ce que ferait l’application" items={idea.features} />
            <List title="Ce qui vous démarquerait" items={idea.differentiators} />
            <List title="Points de vigilance" items={idea.risks} />
            {idea.validation !== null ? <ValidationReport validation={idea.validation} /> : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {idea.projectId !== null ? (
            <a
              href={`/${locale}/projets/${idea.projectId}`}
              className="inline-flex items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 py-2 text-sm font-medium text-white no-underline"
            >
              Ouvrir mon application
            </a>
          ) : (
            <>
              {idea.validation === null ? (
                <Button onClick={onAnalyse} disabled={disabled}>
                  {busy ? 'Analyse…' : 'Analyser cette idée'}
                </Button>
              ) : null}
              <Button
                variant={idea.validation === null ? 'secondary' : 'primary'}
                onClick={onBuild}
                disabled={disabled || !canBuild}
              >
                {busy ? 'Création…' : 'Créer cette application'}
              </Button>
              <Button variant="ghost" onClick={onDiscard} disabled={disabled}>
                Écarter
              </Button>
            </>
          )}
        </div>

        {!canBuild && idea.projectId === null ? (
          <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
            Votre offre actuelle permet de chercher et d&apos;analyser des idées. Pour
            construire l&apos;application, il faudra choisir une formule.
          </p>
        ) : null}
      </CardBody>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  )
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
        {title}
      </h3>
      <ul className="mt-2 grid gap-1 pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function ValidationReport({ validation }: { validation: Validation }) {
  const verdict = VERDICT[validation.verdict]
  return (
    <div className="grid gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        <span className="text-sm text-[var(--color-ink-soft)]">Analyse approfondie</span>
      </div>
      <p className="m-0 text-sm">{validation.verdictReason}</p>

      <dl className="grid gap-2 text-sm">
        <Row label="Taille du marché" value={validation.marketSize} />
        <Row label="Le problème" value={validation.problemAssessment} />
        <Row label="La clientèle" value={validation.audienceAssessment} />
        <Row label="Le prix" value={validation.pricingRationale} />
        <Row label="Trouver des clients" value={`Difficulté ${validation.acquisitionDifficulty}`} />
      </dl>

      <List title="Fonctions indispensables" items={validation.essentialFeatures} />
      <List
        title="À écarter d’une première version"
        items={validation.featuresToAvoid}
      />
      <List title="Où trouver vos premiers clients" items={validation.acquisitionChannels} />

      {validation.competitors.length > 0 ? (
        <div>
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            Ce qui existe déjà
          </h3>
          <ul className="mt-2 grid gap-1 pl-5 text-sm">
            {validation.competitors.map((competitor) => (
              <li key={competitor.name}>
                <strong>{competitor.name}</strong> — {competitor.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {validation.risks.length > 0 ? (
        <div>
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            Risques et comment les réduire
          </h3>
          <ul className="mt-2 grid gap-1 pl-5 text-sm">
            {validation.risks.map((item) => (
              <li key={item.risk}>
                {item.risk} <em className="opacity-80">→ {item.mitigation}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {validation.externalServices.length > 0 ? (
        <Notice tone="neutral" title="Ce qui dépendra d’un service extérieur">
          <ul className="m-0 grid gap-1 pl-5">
            {validation.externalServices.map((service) => (
              <li key={service.name}>
                <strong>{service.name}</strong> — {service.why}{' '}
                {service.paid ? (
                  <Badge tone="caution">payant</Badge>
                ) : (
                  <Badge tone="positive">gratuit</Badge>
                )}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  )
}
