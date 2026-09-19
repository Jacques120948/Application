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
  /**
   * Les champs à demander en plus de la clé, quand celle-ci ne suffit pas.
   *
   * Aucun n'est un secret : ils s'affichent en clair, et c'est voulu — une adresse ou un
   * identifiant tapés de travers derrière des points se corrigent mal.
   */
  extraFields: readonly { name: string; label: string; hint: string; placeholder: string }[] | null
  /** Le mode d'emploi pas à pas, affiché à la demande. */
  guide: { url: string; urlLabel: string; steps: readonly string[]; caution?: string } | null
  connection: {
    id: string
    status: string
    accountLabel: string | null
    connectedAt: string
    hint: string | null
    lastError?: string | null
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
  locale = 'fr',
  notice = null,
}: {
  cards: ProviderCard[]
  categories: Array<{ id: string; label: string }>
  maxConnections: number
  locale?: string
  /** Message au retour d'une autorisation chez un fournisseur. */
  notice?: { tone: 'positive' | 'caution' | 'critical'; text: string } | null
}) {
  const [rows, setRows] = useState(cards)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Carte sur laquelle la dernière erreur s'est produite, pour l'afficher à côté du bouton. */
  const [failedId, setFailedId] = useState<string | null>(null)
  /** Fournisseur dont le mode d'emploi est déplié. */
  const [guideOpen, setGuideOpen] = useState<string | null>(null)
  /** Fournisseur dont le formulaire de clé est ouvert, et ce qui y est saisi. */
  const [opened, setOpened] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [account, setAccount] = useState<Record<string, string>>({})

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
      body: JSON.stringify({ providerId, apiKey, account }),
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
    setAccount({})
    setOpened(null)
    setRows((current) =>
      current.map((row) => (row.id === providerId ? { ...row, connection } : row)),
    )
  }

  /**
   * Autorisation chez le fournisseur : le serveur prépare l'adresse, le navigateur y va.
   * Rien n'est saisi ici — c'est chez le fournisseur que la personne s'identifie.
   */
  async function authorize(providerId: string) {
    setBusy(providerId)
    setError(null)
    setFailedId(providerId)
    const response = await fetch(`/api/connexions/${providerId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    const body = (await response.json().catch(() => ({}))) as { message?: string; url?: string }
    if (!response.ok || body.url === undefined) {
      setBusy(null)
      setError(
        body.message ??
          (response.status === 404
            ? "Ce service n'est pas activé sur cette installation."
            : "L'autorisation n'a pas pu commencer."),
      )
      return
    }
    window.location.assign(body.url)
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
      {notice !== null ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

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

                    {/*
                      Le mode d'emploi, replié par défaut. Il s'adresse à quelqu'un qui n'a
                      jamais ouvert le site du fournisseur : chaque étape dit où cliquer et
                      quoi copier, et le lien mène directement au bon endroit.
                    */}
                    {row.guide !== null && row.status === 'available' ? (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => setGuideOpen(guideOpen === row.id ? null : row.id)}
                          aria-expanded={guideOpen === row.id}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-strong)]"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-xs font-semibold"
                          >
                            ?
                          </span>
                          {guideOpen === row.id ? 'Masquer le mode d’emploi' : 'Comment faire ?'}
                        </button>
                        {guideOpen === row.id ? (
                          <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
                            <ol className="m-0 grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
                              {row.guide.steps.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ol>
                            {row.guide.caution !== undefined ? (
                              <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                                {row.guide.caution}
                              </p>
                            ) : null}
                            <a
                              href={row.guide.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand-strong)]"
                            >
                              {row.guide.urlLabel} <span aria-hidden="true">↗</span>
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-5">
                      {row.connection?.status === 'CONNECTED' ? (
                        <div className="grid gap-2">
                          <p className="m-0 text-xs text-[var(--color-ink-soft)]">
                            {row.connection.accountLabel ?? 'Votre compte'}
                            {/* L'indice n'a de sens que pour une clé saisie ; un compte autorisé n'en a pas. */}
                            {row.connection.hint === null || row.credential !== 'API_KEY'
                              ? ''
                              : ` · clé ${row.connection.hint}`}
                          </p>
                          <Button
                            variant="secondary"
                            disabled={busy === row.connection.id}
                            onClick={() => void unlink(row.connection?.id ?? '')}
                          >
                            {busy === row.connection.id ? 'Déconnexion…' : 'Déconnecter'}
                          </Button>
                        </div>
                      ) : row.status === 'available' && row.credential === 'OAUTH' ? (
                        <div className="grid gap-2">
                          {row.connection?.status === 'ERROR' && row.connection.lastError !== null ? (
                            <p className="m-0 text-xs text-[var(--color-caution)]">{row.connection.lastError}</p>
                          ) : null}
                          {/* L'erreur est répétée ici, sous les yeux : le bandeau du haut est hors écran. */}
                          {error !== null && failedId === row.id ? (
                            <p className="m-0 text-xs text-[var(--color-critical)]">{error}</p>
                          ) : null}
                          <Button disabled={busy === row.id} onClick={() => void authorize(row.id)}>
                            {busy === row.id
                              ? 'Redirection…'
                              : row.connection?.status === 'ERROR'
                                ? 'Reprendre la connexion'
                                : `Connecter ${row.name}`}
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
                            {(row.extraFields ?? []).map((champ) => (
                              <Field key={champ.name} label={champ.label} hint={champ.hint}>
                                <Input
                                  type="text"
                                  name={champ.name}
                                  autoComplete="off"
                                  spellCheck={false}
                                  required
                                  value={account[champ.name] ?? ''}
                                  placeholder={champ.placeholder}
                                  onChange={(event) =>
                                    setAccount((actuels) => ({
                                      ...actuels,
                                      [champ.name]: event.target.value,
                                    }))
                                  }
                                />
                              </Field>
                            ))}
                            <Field label={row.keyHelp.label} hint={row.keyHelp.hint}>
                              <Input
                                type="password"
                                name="apiKey"
                                autoComplete="off"
                                spellCheck={false}
                                required
                                minLength={8}
                                value={apiKey}
                                placeholder={row.id === 'anthropic' ? 'sk-ant-…' : '••••••••'}
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
                                  setAccount({})
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
                              setAccount({})
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
                            row.id === 'stripe'
                              ? 'le paiement en ligne n’est pas activé sur cette installation'
                              : row.credential === 'OAUTH'
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
