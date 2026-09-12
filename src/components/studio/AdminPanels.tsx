'use client'

import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, CardBody, Field, Input, Notice, Select, Textarea } from '@/components/ui'

/**
 * Écrans du back-office.
 *
 * Ils remplacent les requêtes SQL qu'il fallait écrire à la main. Chaque formulaire dit ce
 * qu'il fait et affiche franchement le résultat : « enregistré » seulement quand le
 * serveur a confirmé, jamais avant.
 */

export type AdminPlan = {
  id: string
  name: string
  description: string
  priceCents: number
  currency: string
  maxProjects: number
  maxConnections: number
  monthlyCredits: number
  allowBuild: boolean
  allowCustomDomain: boolean
  isRecommended: boolean
  isActive: boolean
  sortOrder: number
  features: string[]
  storageBytes: number
}

/** Catalogue des fonctions, passé par le serveur : il n'est pas dupliqué ici. */
export type AdminFeature = {
  id: string
  label: string
  summary: string
  status: 'live' | 'prevu'
}

export type AdminUser = {
  id: string
  email: string
  name: string | null
  role: string
  createdAt: string
  disabled: boolean
  planId: string
  subscriptionStatus: string | null
  credits: number
}

function euros(cents: number): string {
  return (cents / 100).toString()
}

export function PlanEditor({
  plans,
  features,
}: {
  plans: AdminPlan[]
  features: AdminFeature[]
}) {
  return (
    <div className="grid gap-4">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} features={features} />
      ))}
    </div>
  )
}

function PlanCard({ plan, features }: { plan: AdminPlan; features: AdminFeature[] }) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('busy')
    setError(null)
    const form = new FormData(event.currentTarget)
    const response = await fetch(`/api/admin/plans/${plan.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? ''),
        priceCents: Math.round(Number(form.get('price')) * 100),
        maxProjects: Number(form.get('maxProjects')),
        maxConnections: Number(form.get('maxConnections')),
        storageMegabytes: Number(form.get('storageMegabytes')),
        monthlyCredits: Number(form.get('monthlyCredits')),
        allowBuild: form.get('allowBuild') === 'on',
        allowCustomDomain: form.get('allowCustomDomain') === 'on',
        isRecommended: form.get('isRecommended') === 'on',
        isActive: form.get('isActive') === 'on',
        sortOrder: Number(form.get('sortOrder')),
        features: features.filter((feature) => form.get(`feature:${feature.id}`) === 'on').map((feature) => feature.id),
      }),
    })
    const body = (await response.json()) as { message?: string }
    if (!response.ok) {
      setError(body.message ?? "L'enregistrement n'a pas abouti.")
      setStatus('idle')
      return
    }
    setStatus('saved')
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="m-0 text-base font-semibold">{plan.name}</h3>
            <Badge tone="neutral">{plan.id}</Badge>
            {plan.isRecommended ? <Badge tone="brand">Mise en avant</Badge> : null}
            {!plan.isActive ? <Badge tone="caution">Masquée</Badge> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom affiché">
              <Input name="name" maxLength={60} required defaultValue={plan.name} />
            </Field>
            <Field label={`Prix mensuel (${plan.currency})`} hint="Zéro pour une offre gratuite.">
              <Input
                name="price"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={euros(plan.priceCents)}
              />
            </Field>
          </div>

          <Field label="Description">
            <Textarea name="description" maxLength={400} required defaultValue={plan.description} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Applications autorisées">
              <Input
                name="maxProjects"
                type="number"
                min={0}
                max={1000}
                required
                defaultValue={plan.maxProjects}
              />
            </Field>
            <Field label="Connexions externes">
              <Input
                name="maxConnections"
                type="number"
                min={0}
                max={100}
                required
                defaultValue={plan.maxConnections}
              />
            </Field>
            <Field label="Images (Mo)" hint="Espace total pour les photos des applications.">
              <Input
                name="storageMegabytes"
                type="number"
                min={0}
                max={20000}
                required
                defaultValue={Math.round(plan.storageBytes / (1024 * 1024))}
              />
            </Field>
            <Field label="Crédits par mois">
              <Input
                name="monthlyCredits"
                type="number"
                min={0}
                max={1000000}
                required
                defaultValue={plan.monthlyCredits}
              />
            </Field>
            <Field label="Ordre d’affichage">
              <Input
                name="sortOrder"
                type="number"
                min={0}
                max={100}
                required
                defaultValue={plan.sortOrder}
              />
            </Field>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Toggle name="allowBuild" label="Peut construire une application" checked={plan.allowBuild} />
            <Toggle
              name="allowCustomDomain"
              label="Adresse personnalisée"
              checked={plan.allowCustomDomain}
            />
            <Toggle name="isRecommended" label="Mise en avant sur la page d’accueil" checked={plan.isRecommended} />
            <Toggle name="isActive" label="Visible publiquement" checked={plan.isActive} />
          </div>

          <fieldset className="grid gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-medium">Fonctions ouvertes par cette offre</legend>
            <p className="m-0 mb-2 text-xs text-[var(--color-ink-soft)]">
              Une fonction marquée « à construire » peut être cochée dès maintenant : elle
              restera fermée tant qu’elle n’existe pas, et s’ouvrira d’elle-même le jour où
              elle sera prête. Aucune grille tarifaire ne la présente entre-temps.
            </p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {features.map((feature) => (
                <Toggle
                  key={feature.id}
                  name={`feature:${feature.id}`}
                  label={feature.status === 'live' ? feature.label : `${feature.label} (à construire)`}
                  checked={plan.features.includes(feature.id)}
                />
              ))}
            </div>
          </fieldset>

          {error !== null ? <Notice tone="critical">{error}</Notice> : null}
          {status === 'saved' ? (
            <Notice tone="positive">
              Enregistré. La page d’accueil affichera cette offre au prochain chargement.
            </Notice>
          ) : null}

          <div>
            <Button type="submit" disabled={status === 'busy'}>
              {status === 'busy' ? 'Enregistrement…' : 'Enregistrer cette offre'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

function Toggle({
  name,
  label,
  checked,
}: {
  name: string
  label: string
  checked: boolean
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4" />
      <span>{label}</span>
    </label>
  )
}

export function UserTable({ users, plans }: { users: AdminUser[]; plans: AdminPlan[] }) {
  const [rows, setRows] = useState(users)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  async function assign(userId: string, planId: string) {
    setBusyId(userId)
    setError(null)
    setSavedId(null)
    const response = await fetch(`/api/admin/users/${userId}/offre`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId: planId === 'free' ? null : planId }),
    })
    const body = (await response.json()) as { message?: string }
    setBusyId(null)
    if (!response.ok) {
      setError(body.message ?? "L'attribution n'a pas abouti.")
      return
    }
    setRows((current) =>
      current.map((row) => (row.id === userId ? { ...row, planId } : row)),
    )
    setSavedId(userId)
  }

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-ink-soft)]">Aucun compte pour le moment.</p>
  }

  return (
    <div className="grid gap-3">
      {error !== null ? <Notice tone="critical">{error}</Notice> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-[var(--color-ink-soft)]">
              <th className="py-2 pr-4 font-medium">Compte</th>
              <th className="py-2 pr-4 font-medium">Inscrit le</th>
              <th className="py-2 pr-4 font-medium">Crédits</th>
              <th className="py-2 pr-4 font-medium">Offre</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.id} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-3 pr-4">
                  <span className="block font-medium">{user.email}</span>
                  <span className="block text-xs text-[var(--color-ink-soft)]">
                    {user.name ?? '—'}
                    {user.role === 'ADMIN' ? ' · administrateur' : ''}
                    {user.disabled ? ' · désactivé' : ''}
                  </span>
                </td>
                <td className="py-3 pr-4 text-[var(--color-ink-soft)]">
                  {new Date(user.createdAt).toLocaleDateString('fr-CH')}
                </td>
                <td className="py-3 pr-4">{user.credits}</td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <Select
                      value={user.planId}
                      disabled={busyId === user.id}
                      onChange={(event) => void assign(user.id, event.target.value)}
                      className="max-w-44"
                    >
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </Select>
                    {savedId === user.id ? (
                      <span className="text-xs text-[var(--color-positive)]">enregistré</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--color-ink-soft)]">
        Changer l’offre prend effet immédiatement. Les crédits du nouveau palier sont
        accordés à la prochaine ouverture du studio par la personne concernée.
      </p>
    </div>
  )
}

export type LegalIdentity = {
  entity: string
  address: string
  email: string
  country: string
  registration: string
  complete: boolean
}

/**
 * Identité affichée sur les pages légales.
 *
 * Tant qu'elle est incomplète, les mentions légales le disent publiquement : mieux vaut
 * une page qui reconnaît son état qu'une page qui invente une raison sociale.
 */
export function LegalIdentityForm({ identity }: { identity: LegalIdentity }) {
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('busy')
    setError(null)
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/identite', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entity: String(form.get('entity') ?? ''),
        address: String(form.get('address') ?? ''),
        email: String(form.get('email') ?? ''),
        country: String(form.get('country') ?? ''),
        registration: String(form.get('registration') ?? ''),
      }),
    })
    const body = (await response.json()) as { message?: string }
    if (!response.ok) {
      setError(body.message ?? "L'enregistrement n'a pas abouti.")
      setState('idle')
      return
    }
    setState('saved')
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="grid gap-4">
          {!identity.complete ? (
            <Notice tone="caution" title="Identité incomplète">
              Les pages légales affichent aujourd’hui un avertissement à la place de vos
              coordonnées. Remplissez au moins la raison sociale, l’adresse, le pays et
              l’adresse de contact.
            </Notice>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Raison sociale ou nom" hint="Ce qui apparaîtra sur les mentions légales.">
              <Input name="entity" maxLength={120} defaultValue={identity.entity} />
            </Field>
            <Field label="Adresse de contact" hint="Celle à laquelle vos utilisateurs peuvent écrire.">
              <Input type="email" name="email" maxLength={200} defaultValue={identity.email} />
            </Field>
          </div>

          <Field label="Adresse postale">
            <Textarea name="address" maxLength={300} defaultValue={identity.address} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pays">
              <Input name="country" maxLength={80} defaultValue={identity.country} />
            </Field>
            <Field
              label="Numéro d’entreprise ou de TVA"
              hint="Facultatif. Laissez vide si vous n’en avez pas."
            >
              <Input name="registration" maxLength={120} defaultValue={identity.registration} />
            </Field>
          </div>

          {error !== null ? <Notice tone="critical">{error}</Notice> : null}
          {state === 'saved' ? (
            <Notice tone="positive">Enregistré. Les pages légales sont à jour.</Notice>
          ) : null}

          <div>
            <Button type="submit" disabled={state === 'busy'}>
              {state === 'busy' ? 'Enregistrement…' : 'Enregistrer l’identité'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
