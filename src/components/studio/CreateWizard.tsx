'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Blueprint } from '@/server/ai/schemas'
import { Badge, Button, Card, CardBody, Field, Input, Notice, Textarea } from '@/components/ui'

/**
 * Parcours de création (sections 2, 3 et 4 du cahier des charges).
 *
 * Trois écrans seulement : décrire, valider le plan proposé, construire.
 * Aucun réglage technique n'est demandé à l'utilisateur.
 */

const EXAMPLES = [
  'une application de coaching',
  'un outil pour les réseaux sociaux',
  'une application de recettes',
  'une application pour artisans',
  'une application de réservation',
  'une application avec abonnement',
  'une application éducative',
  'une application communautaire',
] as const

type Idea = {
  title: string
  problem: string
  audience: string
  solution: string
  features: string[]
  monetization: string
  difficulty: string
  startingCost: string
  competition: string
  potential: string
}

type Step =
  | { name: 'describe' }
  | { name: 'findIdea' }
  | { name: 'review'; blueprint: Blueprint; source: 'assistant' | 'modele-de-depart' }

export function CreateWizard({ locale }: { locale: string }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ name: 'describe' })
  const [idea, setIdea] = useState('')
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'analyse' | 'create' | 'ideas'>(null)

  async function call<T>(url: string, payload: unknown): Promise<T | null> {
    setError(null)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await response.json()) as T & { message?: string }
    if (!response.ok) {
      setError(body.message ?? "L'opération n'a pas abouti.")
      return null
    }
    return body
  }

  async function analyse() {
    if (idea.trim().length < 10) {
      setError('Décrivez votre idée en quelques mots de plus.')
      return
    }
    setBusy('analyse')
    const result = await call<{ blueprint: Blueprint; source: 'assistant' | 'modele-de-depart' }>(
      '/api/projects/analyse',
      { idea, locale },
    )
    setBusy(null)
    if (result !== null) setStep({ name: 'review', blueprint: result.blueprint, source: result.source })
  }

  async function build(blueprint: Blueprint) {
    setBusy('create')
    const result = await call<{ projectId: string }>('/api/projects', { idea, locale, blueprint })
    setBusy(null)
    if (result !== null) {
      router.push(`/${locale}/projets/${result.projectId}`)
      router.refresh()
    }
  }

  async function findIdeas(form: FormData) {
    setBusy('ideas')
    const result = await call<{ ideas: Idea[] }>('/api/ideas', {
      goal: String(form.get('goal') ?? ''),
      skills: String(form.get('skills') ?? ''),
      sector: String(form.get('sector') ?? ''),
      budget: String(form.get('budget') ?? ''),
      time: String(form.get('time') ?? ''),
      country: String(form.get('country') ?? ''),
      audience: String(form.get('audience') ?? ''),
      locale,
    })
    setBusy(null)
    if (result !== null) setIdeas(result.ideas)
  }

  if (step.name === 'review') {
    return (
      <ReviewStep
        blueprint={step.blueprint}
        source={step.source}
        busy={busy === 'create'}
        error={error}
        onBack={() => setStep({ name: 'describe' })}
        onConfirm={build}
      />
    )
  }

  if (step.name === 'findIdea') {
    return (
      <div className="grid gap-5">
        <Button variant="ghost" onClick={() => setStep({ name: 'describe' })} className="justify-self-start">
          ← Retour
        </Button>
        <Card>
          <CardBody>
            <h2 className="mt-0 text-lg font-semibold">Trouvons une idée ensemble</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              Quelques questions, puis des pistes concrètes. Aucun revenu n&apos;est promis :
              nous parlons de potentiel de monétisation.
            </p>
            <form
              className="mt-5 grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                void findIdeas(new FormData(event.currentTarget))
              }}
            >
              <Field label="Ce que vous recherchez">
                <Input
                  name="goal"
                  required
                  defaultValue="un revenu complémentaire de quelques centaines d'euros par mois"
                />
              </Field>
              <Field label="Vos compétences">
                <Input name="skills" placeholder="cuisine, bricolage, enseignement…" />
              </Field>
              <Field label="Secteur qui vous intéresse">
                <Input name="sector" placeholder="bien-être, artisanat, éducation…" />
              </Field>
              <Field label="Budget de départ">
                <Input name="budget" placeholder="moins de 100 €" />
              </Field>
              <Field label="Temps disponible par semaine">
                <Input name="time" placeholder="5 heures" />
              </Field>
              <Field label="Pays">
                <Input name="country" placeholder="France" />
              </Field>
              <Field label="Clientèle visée">
                <Input name="audience" placeholder="particuliers, professionnels…" />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" size="large" disabled={busy === 'ideas'}>
                  {busy === 'ideas' ? 'Recherche…' : 'Proposer des idées'}
                </Button>
              </div>
            </form>
            {error !== null ? (
              <div className="mt-4">
                <Notice tone="critical">{error}</Notice>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {ideas !== null
          ? ideas.map((suggestion) => (
              <Card key={suggestion.title}>
                <CardBody>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="m-0 text-base font-semibold">{suggestion.title}</h3>
                    <Badge tone="brand">Difficulté {suggestion.difficulty}</Badge>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <Row label="Problème" value={suggestion.problem} />
                    <Row label="Cible" value={suggestion.audience} />
                    <Row label="Solution" value={suggestion.solution} />
                    <Row label="Fonctionnalités" value={suggestion.features.join(', ')} />
                    <Row label="Monétisation" value={suggestion.monetization} />
                    <Row label="Coût de départ" value={suggestion.startingCost} />
                    <Row label="Concurrence" value={suggestion.competition} />
                    <Row label="Potentiel de monétisation" value={suggestion.potential} />
                  </dl>
                  <Button
                    className="mt-4"
                    onClick={() => {
                      setIdea(`${suggestion.title}. ${suggestion.solution}`)
                      setStep({ name: 'describe' })
                    }}
                  >
                    Partir de cette idée
                  </Button>
                </CardBody>
              </Card>
            ))
          : null}
      </div>
    )
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mt-0 text-lg font-semibold">Que souhaitez-vous créer ?</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setIdea(`Je voudrais ${example}.`)}
              className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]"
            >
              {example}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setStep({ name: 'findIdea' })}
            className="rounded-full border border-[var(--color-brand)] px-3 py-1.5 text-sm text-[var(--color-brand)]"
          >
            Je n&apos;ai pas encore d&apos;idée
          </button>
        </div>

        <div className="mt-6">
          <Field label="Décrivez votre idée">
            <Textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              maxLength={2000}
              placeholder="Exemple : une application pour aider les propriétaires de chiens à trouver des promenades près de chez eux."
            />
          </Field>
        </div>

        {error !== null ? (
          <div className="mt-4">
            <Notice tone="critical">{error}</Notice>
          </div>
        ) : null}

        <Button size="large" className="mt-5" onClick={() => void analyse()} disabled={busy === 'analyse'}>
          {busy === 'analyse' ? 'Analyse en cours…' : 'Analyser mon idée'}
        </Button>
      </CardBody>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <dt className="text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  )
}

function ReviewStep({
  blueprint,
  source,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  blueprint: Blueprint
  source: 'assistant' | 'modele-de-depart'
  busy: boolean
  error: string | null
  onBack: () => void
  onConfirm: (blueprint: Blueprint) => void
}) {
  const [draft, setDraft] = useState(blueprint)

  return (
    <div className="grid gap-5">
      <Button variant="ghost" onClick={onBack} className="justify-self-start">
        ← Modifier mon idée
      </Button>

      {source === 'modele-de-depart' ? (
        <Notice tone="caution" title="Assistant non configuré">
          Cette structure vient d&apos;un modèle de départ choisi par mots-clés, pas d&apos;une
          analyse de votre idée. Votre application sera fonctionnelle, mais moins
          personnalisée.
        </Notice>
      ) : null}

      <Card>
        <CardBody>
          <h2 className="mt-0 text-lg font-semibold">Voici ce que je vous propose</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Nom de l'application">
              <Input
                value={draft.appName}
                maxLength={60}
                onChange={(event) => setDraft({ ...draft, appName: event.target.value })}
              />
            </Field>
            <Field label="Phrase de présentation">
              <Input
                value={draft.tagline}
                maxLength={160}
                onChange={(event) => setDraft({ ...draft, tagline: event.target.value })}
              />
            </Field>
          </div>

          <p className="mt-4 text-sm text-[var(--color-ink-soft)]">{draft.concept}</p>

          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            Fonctions prévues
          </h3>
          <ul className="mt-2 grid gap-2 pl-5 text-sm">
            {draft.features.map((feature) => (
              <li key={feature.title}>
                <strong>{feature.title}</strong> — {feature.body}
              </li>
            ))}
          </ul>

          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            Pistes de monétisation
          </h3>
          <ul className="mt-2 grid gap-2 pl-5 text-sm">
            {draft.monetization.map((option) => (
              <li key={option.label}>
                <strong>{option.label}</strong> — {option.rationale}
              </li>
            ))}
          </ul>

          {draft.limitations.length > 0 ? (
            <div className="mt-6">
              <Notice tone="caution" title="À savoir avant de lancer">
                <ul className="m-0 grid gap-1 pl-5">
                  {draft.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </Notice>
            </div>
          ) : null}

          {error !== null ? (
            <div className="mt-4">
              <Notice tone="critical">{error}</Notice>
            </div>
          ) : null}

          <Button size="large" className="mt-6" disabled={busy} onClick={() => onConfirm(draft)}>
            {busy ? 'Construction en cours…' : 'Créer cette application'}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
