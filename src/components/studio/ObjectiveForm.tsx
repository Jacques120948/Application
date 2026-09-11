'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button, Card, CardBody, Field, Input, Notice, Select, Textarea } from '@/components/ui'

/**
 * Première étape du parcours : l'objectif, puis le profil.
 *
 * On ne demande jamais « que voulez-vous construire ? ». On demande où la personne veut
 * aller et avec quoi elle part. C'est à partir de là que la plateforme propose.
 */

const OBJECTIVES = [30_000, 50_000, 100_000, 200_000] as const

/**
 * Monnaies proposées. Rien n'est converti : un objectif en francs donne des prix pensés
 * pour le marché suisse, un objectif en euros des prix pensés pour la zone euro.
 */
const CURRENCIES = [
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'CHF', label: 'Franc suisse (CHF)' },
] as const

const FORMAT_LOCALE: Record<string, string> = { EUR: 'fr-FR', CHF: 'fr-CH' }

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(FORMAT_LOCALE[currency] ?? 'fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function currencyName(currency: string): string {
  return currency === 'CHF' ? 'francs suisses' : 'euros'
}

export type ExistingProfile = {
  monthlyGoalCents: number
  weeklyHours: number
  budgetCents: number
  currency: string
  country: string
  skills: string
  interests: string
  sector: string
  audience: string
  ambition: string
  preferredModel: string
} | null

export function ObjectiveForm({ locale, profile }: { locale: string; profile: ExistingProfile }) {
  const router = useRouter()
  const [goal, setGoal] = useState(profile?.monthlyGoalCents ?? 100_000)
  const [customGoal, setCustomGoal] = useState('')
  const [currency, setCurrency] = useState(profile?.currency ?? 'EUR')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const custom = Number(customGoal.replace(/[^\d]/g, ''))
    const monthlyGoalCents = customGoal.trim() !== '' && custom > 0 ? custom * 100 : goal

    const response = await fetch('/api/profil', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        monthlyGoalCents,
        weeklyHours: Number(form.get('weeklyHours')),
        budgetCents: Number(form.get('budget')) * 100,
        currency,
        country: String(form.get('country') ?? 'France'),
        skills: String(form.get('skills') ?? ''),
        interests: String(form.get('interests') ?? ''),
        sector: String(form.get('sector') ?? ''),
        audience: String(form.get('audience') ?? 'particuliers'),
        ambition: String(form.get('ambition') ?? 'simple'),
        preferredModel: String(form.get('preferredModel') ?? 'indifferent'),
      }),
    })
    const body = (await response.json()) as { message?: string }

    if (!response.ok) {
      setError(body.message ?? "L'enregistrement n'a pas abouti.")
      setBusy(false)
      return
    }
    router.push(`/${locale}/idees`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Card>
        <CardBody>
          <h2 className="mt-0 text-lg font-semibold">
            Quel revenu complémentaire aimeriez-vous viser ?
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Cet objectif sert uniquement à orienter votre projet. Ce n&apos;est ni une
            prévision, ni une promesse de revenu.
          </p>

          <div className="mt-4 max-w-xs">
            <Field
              label="Votre monnaie"
              hint="Les prix conseillés seront pensés pour ce marché, sans conversion."
            >
              <Select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {CURRENCIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {OBJECTIVES.map((cents) => (
              <button
                key={cents}
                type="button"
                onClick={() => {
                  setGoal(cents)
                  setCustomGoal('')
                }}
                className={
                  goal === cents && customGoal === ''
                    ? 'rounded-full border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-4 py-2 text-sm font-medium text-[var(--color-brand-strong)]'
                    : 'rounded-full border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-ink-soft)] hover:border-[var(--color-ink-faint)]'
                }
              >
                {formatMoney(cents, currency)} par mois
              </button>
            ))}
          </div>

          <div className="mt-4 max-w-xs">
            <Field label={`Ou un autre montant (en ${currencyName(currency)} par mois)`}>
              <Input
                inputMode="numeric"
                value={customGoal}
                onChange={(event) => setCustomGoal(event.target.value)}
                placeholder="750"
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="mt-0 text-lg font-semibold">Ce dont vous disposez</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Temps disponible par semaine (heures)">
              <Input
                type="number"
                name="weeklyHours"
                min={1}
                max={80}
                required
                defaultValue={profile?.weeklyHours ?? 5}
              />
            </Field>
            <Field
              label={`Budget de départ (${currencyName(currency)})`}
              hint="Zéro est une réponse valable."
            >
              <Input
                type="number"
                name="budget"
                min={0}
                max={10_000}
                required
                defaultValue={(profile?.budgetCents ?? 0) / 100}
              />
            </Field>
            <Field label="Pays" hint="Il oriente le marché visé, pas la monnaie.">
              <Input name="country" maxLength={60} defaultValue={profile?.country ?? 'France'} />
            </Field>
            <Field label="Secteur dans lequel vous travaillez">
              <Input
                name="sector"
                maxLength={200}
                placeholder="bâtiment, santé, enseignement…"
                defaultValue={profile?.sector ?? ''}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4">
            <Field label="Ce que vous savez faire" hint="Métier, savoir-faire, logiciels que vous maîtrisez.">
              <Textarea
                name="skills"
                maxLength={400}
                placeholder="Je suis coiffeuse, je gère un salon depuis dix ans et je connais bien les plannings."
                defaultValue={profile?.skills ?? ''}
              />
            </Field>
            <Field label="Ce qui vous intéresse" hint="Vos passions comptent : on travaille mieux sur ce qu'on aime.">
              <Textarea
                name="interests"
                maxLength={400}
                placeholder="La randonnée, la cuisine, aider les petites entreprises."
                defaultValue={profile?.interests ?? ''}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="mt-0 text-lg font-semibold">Le projet que vous imaginez</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Vous préférez vendre à">
              <Select name="audience" defaultValue={profile?.audience ?? 'particuliers'}>
                <option value="particuliers">Des particuliers</option>
                <option value="professionnels">Des professionnels</option>
                <option value="les-deux">Peu importe</option>
              </Select>
            </Field>
            <Field label="Ampleur du projet">
              <Select name="ambition" defaultValue={profile?.ambition ?? 'simple'}>
                <option value="simple">Quelque chose de simple</option>
                <option value="ambitieux">Je peux voir plus grand</option>
              </Select>
            </Field>
            <Field label="Comment aimeriez-vous être payé">
              <Select name="preferredModel" defaultValue={profile?.preferredModel ?? 'indifferent'}>
                <option value="indifferent">Peu importe</option>
                <option value="subscription">Un abonnement</option>
                <option value="one_time">Un achat unique</option>
                <option value="freemium">Gratuit puis payant</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      <div>
        <Button type="submit" size="large" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Voir les idées adaptées à mon profil'}
        </Button>
      </div>
    </form>
  )
}
