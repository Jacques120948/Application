'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, Card, CardBody, Notice } from '@/components/ui'
import {
  formatMoney,
  formatPrice,
  MODEL_LABEL,
  scoreTone,
  type BoardIdea,
  type SpecSheet,
  type Validation,
} from './idea-types'

/**
 * Fiche d'étude d'une idée : étapes 4 et 5 du parcours.
 *
 * L'enchaînement est volontairement linéaire et explicite. On analyse, on lit le cahier
 * des charges, puis seulement on construit. Chaque bouton dit ce qu'il va se passer et ce
 * que cela coûte en crédits, sans jamais présenter une étape comme automatique.
 */

const VERDICT: Record<
  Validation['verdict'],
  { label: string; tone: 'positive' | 'caution' | 'critical' }
> = {
  'a-lancer': { label: 'À lancer', tone: 'positive' },
  'a-ajuster': { label: 'À ajuster avant de lancer', tone: 'caution' },
  'a-eviter': { label: 'Mieux vaut chercher autre chose', tone: 'critical' },
}

export function IdeaStudy({
  locale,
  initialIdea,
  canBuild,
  aiAvailable,
}: {
  locale: string
  initialIdea: BoardIdea
  canBuild: boolean
  aiAvailable: boolean
}) {
  const router = useRouter()
  const [idea, setIdea] = useState(initialIdea)
  const [busy, setBusy] = useState<null | 'analyse' | 'cahier' | 'build'>(null)
  const [error, setError] = useState<string | null>(null)

  async function call(step: 'analyse' | 'cahier', path: string) {
    setBusy(step)
    setError(null)
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    const body = (await response.json()) as { idea?: BoardIdea; message?: string }
    setBusy(null)
    if (!response.ok || body.idea === undefined) {
      setError(body.message ?? "L'opération n'a pas abouti.")
      return
    }
    setIdea(body.idea)
  }

  async function build() {
    setBusy('build')
    setError(null)
    const response = await fetch(`/api/idees/${idea.id}/construire`, {
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

  return (
    <div className="grid gap-5">
      <a href={`/${locale}/idees`} className="text-sm text-[var(--color-brand)]">
        ← Toutes mes idées
      </a>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-2xl font-semibold">{idea.title}</h1>
              <p className="m-0 mt-1 text-[var(--color-ink-soft)]">{idea.valueProposition}</p>
            </div>
            <Badge tone={scoreTone(idea.opportunityScore)}>
              Potentiel {idea.opportunityScore}/100
            </Badge>
          </div>

          <dl className="mt-5 grid gap-4 sm:grid-cols-4">
            <Figure label="Le problème" value={idea.problem} wide />
            <Figure label="Pour qui" value={idea.audience} />
            <Figure label="Modèle" value={MODEL_LABEL[idea.businessModel] ?? idea.businessModel} />
            <Figure
              label="Prix conseillé"
              value={formatPrice(idea.recommendedPriceCents, idea.priceInterval, idea.currency)}
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

          <div className="mt-5 rounded-[var(--radius-card)] bg-[var(--color-brand-soft)] px-4 py-3">
            <p className="m-0 text-sm font-medium text-[var(--color-brand-strong)]">
              {!idea.comparableToObjective
                ? 'Montants non comparables à votre objectif actuel'
                : idea.customersNeeded > 0
                  ? `Environ ${idea.customersNeeded} client(s) pour votre objectif`
                  : 'Cette idée ne génère pas directement de chiffre d’affaires'}
            </p>
            <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">
              {idea.objectiveSentence}
            </p>
          </div>
        </CardBody>
      </Card>

      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      <Step
        number={1}
        title="Analyser l’idée"
        done={idea.validation !== null}
        summary="Marché, concurrents, prix, risques et fonctions vraiment indispensables."
        action="Lancer l’analyse"
        cost="environ 7 crédits"
        busy={busy === 'analyse'}
        disabled={busy !== null || !aiAvailable}
        onRun={() => void call('analyse', `/api/idees/${idea.id}/analyse`)}
      >
        {idea.validation !== null ? <ValidationReport validation={idea.validation} /> : null}
      </Step>

      <Step
        number={2}
        title="Lire le cahier des charges"
        done={idea.specSheet !== null}
        locked={idea.validation === null}
        lockedReason="Faites d’abord analyser l’idée."
        summary="Ce qui sera construit, ce qui attendra, et ce que vos utilisateurs pourront faire."
        action="Rédiger le cahier des charges"
        cost="environ 8 crédits"
        busy={busy === 'cahier'}
        disabled={busy !== null || !aiAvailable}
        onRun={() => void call('cahier', `/api/idees/${idea.id}/cahier-des-charges`)}
      >
        {idea.specSheet !== null ? <SpecSheetView sheet={idea.specSheet} currency={idea.currency} /> : null}
      </Step>

      <Card>
        <CardBody>
          <h2 className="mt-0 text-lg font-semibold">3. Créer ce projet</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Nous construisons la première version à partir du cahier des charges que vous
            venez de lire. Comptez une minute environ.
          </p>

          {idea.projectId !== null ? (
            <a
              href={`/${locale}/projets/${idea.projectId}`}
              className="mt-4 inline-flex items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-6 py-3 text-sm font-medium text-white no-underline"
            >
              Ouvrir mon application
            </a>
          ) : (
            <>
              <Button
                size="large"
                className="mt-4"
                onClick={() => void build()}
                disabled={busy !== null || !canBuild || idea.specSheet === null}
              >
                {busy === 'build' ? 'Construction en cours…' : 'Créer ce projet'}
              </Button>
              {idea.specSheet === null ? (
                <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
                  Lisez d&apos;abord le cahier des charges : c&apos;est lui qui décrit ce
                  qui sera construit.
                </p>
              ) : null}
              {!canBuild ? (
                <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
                  Votre offre actuelle permet de chercher et d&apos;étudier des idées. Pour
                  construire l&apos;application, il faudra choisir une formule.
                </p>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Step({
  number,
  title,
  summary,
  action,
  cost,
  done,
  locked,
  lockedReason,
  busy,
  disabled,
  onRun,
  children,
}: {
  number: number
  title: string
  summary: string
  action: string
  cost: string
  done: boolean
  locked?: boolean
  lockedReason?: string
  busy: boolean
  disabled: boolean
  onRun: () => void
  children?: React.ReactNode
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 text-lg font-semibold">
            {number}. {title}
          </h2>
          {done ? <Badge tone="positive">Fait</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{summary}</p>

        {!done ? (
          locked === true ? (
            <p className="mt-4 text-sm text-[var(--color-ink-soft)]">{lockedReason}</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={onRun} disabled={disabled}>
                {busy ? 'En cours…' : action}
              </Button>
              <span className="text-xs text-[var(--color-ink-soft)]">{cost}</span>
            </div>
          )
        ) : null}

        {children !== undefined && children !== null ? <div className="mt-5">{children}</div> : null}
      </CardBody>
    </Card>
  )
}

function Figure({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide === true ? 'sm:col-span-4' : undefined}>
      <dt className="m-0 text-xs text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 mt-0.5 text-sm font-medium">{value}</dd>
    </div>
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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
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
      <List title="À écarter d’une première version" items={validation.featuresToAvoid} />
      <List title="Où trouver vos premiers clients" items={validation.acquisitionChannels} />
      <List title="Ce qui vous démarquerait" items={validation.differentiators} />

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

      <ExternalServices services={validation.externalServices} />
    </div>
  )
}

function SpecSheetView({ sheet, currency }: { sheet: SpecSheet; currency: string }) {
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="m-0 text-base font-semibold">{sheet.appName}</h3>
        <p className="m-0 mt-1 text-sm text-[var(--color-ink-soft)]">{sheet.tagline}</p>
        <p className="mt-3 text-sm">{sheet.summary}</p>
      </div>

      <dl className="grid gap-2 text-sm">
        <Row label="Pour qui" value={sheet.forWho} />
        <Row label="Le problème" value={sheet.problem} />
        <Row
          label="Ce qui est payant"
          value={`${sheet.whatIsPaid} (${formatPrice(sheet.priceCents, sheet.priceInterval, currency)})`}
        />
        <Row
          label="Comptes utilisateurs"
          value={sheet.accountsNeeded ? 'Oui, vos visiteurs pourront créer un compte' : 'Non'}
        />
        <Row
          label="Coût de fonctionnement"
          value={
            sheet.runningCostCents > 0
              ? `${formatMoney(sheet.runningCostCents, currency)} par mois environ`
              : 'proche de zéro'
          }
        />
      </dl>

      <Detailed
        title="Ce que fera la première version"
        items={sheet.mvpFeatures.map((item) => ({ head: item.title, body: item.why }))}
      />
      <Detailed
        title="Ce qui attendra une prochaine version"
        items={sheet.postponed.map((item) => ({ head: item.title, body: item.why }))}
      />
      <Detailed
        title="Les écrans"
        items={sheet.screens.map((screen) => ({
          head: `${screen.name}${screen.requiresAccount ? ' (réservé aux membres)' : ''}`,
          body: screen.purpose,
        }))}
      />
      <Detailed
        title="Qui peut faire quoi"
        items={sheet.roles.map((role) => ({ head: role.name, body: role.canDo }))}
      />
      <Detailed
        title="Ce que l’application retient"
        items={sheet.storedData.map((data) => ({
          head: `${data.name}${data.private ? ' (privé à chaque personne)' : ''}`,
          body: data.description,
        }))}
      />

      <ExternalServices services={sheet.externalServices} />
    </div>
  )
}

function Detailed({
  title,
  items,
}: {
  title: string
  items: Array<{ head: string; body: string }>
}) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
        {title}
      </h3>
      <ul className="mt-2 grid gap-1.5 pl-5 text-sm">
        {items.map((item) => (
          <li key={item.head}>
            <strong>{item.head}</strong> — {item.body}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Transparence : ce qui dépendra d'un tiers, et ce que cela coûte. */
function ExternalServices({
  services,
}: {
  services: Array<{ name: string; why: string; paid: boolean }>
}) {
  if (services.length === 0) return null
  return (
    <Notice tone="neutral" title="Ce qui dépendra d’un service extérieur">
      <ul className="m-0 grid gap-1 pl-5">
        {services.map((service) => (
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
  )
}
