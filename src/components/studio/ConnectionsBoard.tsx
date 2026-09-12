'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardBody, ComingSoon, Field, Input, Notice } from '@/components/ui'

/**
 * Écran « Connexions ».
 *
 * Deux partis pris. Le coût externe est annoncé sur chaque carte, avant la connexion, pas
 * après : c'est le service du créateur qui sera facturé, il doit le savoir en amont. Et un
 * service pas encore connectable affiche ce qu'il lui manque au lieu d'un bouton inerte.
 */

export type ProviderCard = {
  id: string
  name: string
  category: string
  summary: string
  usage: string
  status: 'available' | 'planned'
  credential: 'OAUTH' | 'API_KEY'
  costNotice: string
  costLabel: string
  /** Où le créateur va chercher sa clé, quand le service s'en remet à une clé. */
  keyHelp: { label: string; hint: string } | null
  connection: {
    id: string
    status: string
    accountLabel: string | null
    connectedAt: string
    hint: string | null
  } | null
}

const STATUS_LABEL: Record<string, string> = {
  CONNECTED: 'Connecté',
  EXPIRED: 'Autorisation expirée',
  REVOKED: 'Déconnecté',
  ERROR: 'En erreur',
}

export function ConnectionsBoard({
  cards,
  categories,
  maxConnections,
}: {
  cards: ProviderCard[]
  categories: Array<{ id: string; label: string }>
  maxConnections: number
}) {
  const [rows, setRows] = useState(cards)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Fournisseur dont le formulaire de clé est ouvert, et ce qui y est saisi. */
  const [opened, setOpened] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')

  const active = rows.filter((row) => row.connection?.status === 'CONNECTED').length

  /*
   * Ce qui est connectable d'abord. La plupart des services du catalogue sont encore des
   * fiches : les laisser en tête ferait descendre en bas de page la seule chose que le
   * créateur peut réellement faire aujourd'hui.
   */
  const ordered = [...categories].sort((a, b) => {
    const open = (id: string) =>
      Number(rows.some((row) => row.category === id && row.status === 'available'))
    return open(b.id) - open(a.id)
  })

  async function link(providerId: string) {
    setBusy(providerId)
    setError(null)
    const response = await fetch('/api/connexions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId, apiKey }),
    })
    const body = (await response.json()) as {
      message?: string
      connection?: ProviderCard['connection']
    }
    setBusy(null)
    if (!response.ok || body.connection === undefined || body.connection === null) {
      setError(body.message ?? "La connexion n'a pas abouti.")
      return
    }
    const connection = body.connection
    // La clé quitte la mémoire du navigateur dès qu'elle est enregistrée.
    setApiKey('')
    setOpened(null)
    setRows((current) =>
      current.map((row) => (row.id === providerId ? { ...row, connection } : row)),
    )
  }

  async function unlink(connectionId: string) {
    setBusy(connectionId)
    setError(null)
    const response = await fetch('/api/connexions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectionId }),
    })
    const body = (await response.json()) as { message?: string }
    setBusy(null)
    if (!response.ok) {
      setError(body.message ?? "La déconnexion n'a pas abouti.")
      return
    }
    setRows((current) =>
      current.map((row) => (row.connection?.id === connectionId ? { ...row, connection: null } : row)),
    )
  }

  return (
    <div className="grid gap-8">
      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      <Notice tone="neutral" title="Vos comptes restent les vôtres">
        Evoliia ne demande jamais vos mots de passe et ne recopie pas vos fichiers. Vous
        autorisez un accès précis, vous le retirez quand vous voulez, et ce que vous
        consommez chez le fournisseur reste sur votre propre compte.
        {maxConnections > 0 ? (
          <span className="mt-1 block">
            Votre offre permet {maxConnections} connexion(s). {active} utilisée(s).
          </span>
        ) : null}
      </Notice>

      {ordered.map((category) => {
        const inCategory = rows
          .filter((row) => row.category === category.id)
          .sort((a, b) => Number(b.status === 'available') - Number(a.status === 'available'))
        if (inCategory.length === 0) return null
        return (
          <section key={category.id}>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
              {category.label}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {inCategory.map((row) => (
                <Card key={row.id} className="flex flex-col">
                  <CardBody className="flex flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="m-0 text-base font-semibold">{row.name}</h3>
                      {row.connection?.status === 'CONNECTED' ? (
                        <Badge tone="positive">
                          ✓ {STATUS_LABEL[row.connection.status] ?? row.connection.status}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Non connecté</Badge>
                      )}
                    </div>

                    <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{row.summary}</p>
                    <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{row.usage}</p>

                    <dl className="mt-4 grid gap-1 text-xs text-[var(--color-ink-soft)]">
                      <div className="flex gap-2">
                        <dt>Coût Evoliia</dt>
                        <dd className="m-0 font-medium text-[var(--color-ink)]">Inclus</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt>Coût {row.name}</dt>
                        <dd className="m-0 font-medium text-[var(--color-ink)]">{row.costLabel}</dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-faint)]">
                      {row.costNotice}
                    </p>

                    <div className="mt-5">
                      {row.connection?.status === 'CONNECTED' ? (
                        <div className="grid gap-2">
                          <p className="m-0 text-xs text-[var(--color-ink-soft)]">
                            {row.connection.accountLabel ?? 'Votre compte'}
                            {row.connection.hint === null ? '' : ` · clé ${row.connection.hint}`}
                          </p>
                          <Button
                            variant="secondary"
                            disabled={busy === row.connection.id}
                            onClick={() => void unlink(row.connection?.id ?? '')}
                          >
                            {busy === row.connection.id ? 'Déconnexion…' : 'Déconnecter'}
                          </Button>
                        </div>
                      ) : row.status === 'available' && row.keyHelp !== null ? (
                        opened === row.id ? (
                          <form
                            className="grid gap-3"
                            onSubmit={(event) => {
                              event.preventDefault()
                              void link(row.id)
                            }}
                          >
                            <Field label={row.keyHelp.label} hint={row.keyHelp.hint}>
                              <Input
                                type="password"
                                name="apiKey"
                                autoComplete="off"
                                spellCheck={false}
                                required
                                minLength={8}
                                value={apiKey}
                                placeholder="sk-ant-…"
                                onChange={(event) => setApiKey(event.target.value)}
                              />
                            </Field>
                            <div className="flex gap-2">
                              <Button type="submit" disabled={busy === row.id}>
                                {busy === row.id ? 'Vérification…' : 'Enregistrer la clé'}
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => {
                                  setApiKey('')
                                  setOpened(null)
                                }}
                              >
                                Annuler
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <Button
                            onClick={() => {
                              setApiKey('')
                              setError(null)
                              setOpened(row.id)
                            }}
                          >
                            Connecter
                          </Button>
                        )
                      ) : (
                        <ComingSoon
                          what={`Connexion à ${row.name}`}
                          when={
                            row.credential === 'OAUTH'
                              ? 'la déclaration de l’application chez le fournisseur reste à faire'
                              : 'ce service sera ouvert après validation'
                          }
                        />
                      )}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
