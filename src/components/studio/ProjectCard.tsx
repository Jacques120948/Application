'use client'

import { useState } from 'react'
import { Badge, Card, CardBody } from '@/components/ui'

/**
 * Vignette d'une application, avec ce qu'elle a produit et ce qu'on peut en faire.
 *
 * Les actions vivent ici plutôt que dans le projet parce que ce sont celles qu'on veut
 * faire sans entrer : ouvrir l'application, copier son adresse pour l'envoyer à quelqu'un,
 * la renommer. Entrer dans l'atelier pour copier un lien est une marche pour rien.
 *
 * La suppression demande confirmation et le dit franchement : ce qui est supprimé cesse
 * d'être servi au public immédiatement.
 */

export type CardStats = { views: number; signups: number; records: number }

export type CardProject = {
  id: string
  name: string
  slug: string
  status: string
  tagline: string
  themeColor: string
  themeAccent: string
  readyScore: number | null
  publicUrl: string | null
}

export function ProjectCard({
  project,
  locale,
  statusLabel,
  stats,
  windowDays,
  canLaunch,
}: {
  project: CardProject
  locale: string
  statusLabel: string
  stats: CardStats | null
  windowDays: number
  canLaunch: boolean
}) {
  const [name, setName] = useState(project.name)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const [removed, setRemoved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const published = project.status === 'PUBLISHED'

  if (removed) return null

  async function rename() {
    const wanted = draft.trim()
    if (wanted === '' || wanted === name) {
      setRenaming(false)
      return
    }
    setBusy(true)
    const response = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: wanted }),
    })
    const body = (await response.json()) as { message?: string }
    setBusy(false)
    if (!response.ok) {
      setError(body.message ?? "Le nom n'a pas pu être changé.")
      return
    }
    setName(wanted)
    setRenaming(false)
    setError(null)
  }

  async function remove() {
    const warning = published
      ? `Supprimer « ${name} » ? Elle cessera immédiatement d’être accessible à vos visiteurs.`
      : `Supprimer « ${name} » ?`
    if (!window.confirm(warning)) return
    setBusy(true)
    const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
    const body = (await response.json()) as { message?: string }
    setBusy(false)
    if (!response.ok) {
      setError(body.message ?? "La suppression n'a pas abouti.")
      return
    }
    setRemoved(true)
  }

  async function copy() {
    if (project.publicUrl === null) return
    try {
      await navigator.clipboard.writeText(project.publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('La copie a été refusée par votre navigateur.')
    }
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <a href={`/${locale}/projets/${project.id}`} className="no-underline">
        <div
          className="relative h-24 overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${project.themeColor} 0%, ${project.themeAccent} 100%)`,
          }}
          aria-hidden="true"
        >
          <div
            className="absolute -right-8 -top-10 h-32 w-32 rounded-full opacity-25 blur-2xl"
            style={{ background: '#ffffff' }}
          />
        </div>
      </a>

      <CardBody className="grid flex-1 gap-3">
        <div className="flex items-start gap-3">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void rename()
                if (event.key === 'Escape') {
                  setDraft(name)
                  setRenaming(false)
                }
              }}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-brand)] px-2 py-1 text-base font-semibold"
              aria-label="Nom du projet"
            />
          ) : (
            <a
              href={`/${locale}/projets/${project.id}`}
              className="text-base font-semibold text-[var(--color-ink)] no-underline"
            >
              {name}
            </a>
          )}
          {renaming ? null : (
            <span className="ml-auto shrink-0">
              <Badge tone={published ? 'positive' : 'neutral'}>{statusLabel}</Badge>
            </span>
          )}
        </div>

        {project.tagline === '' ? null : (
          <p className="m-0 line-clamp-2 text-sm text-[var(--color-ink-soft)]">
            {project.tagline}
          </p>
        )}

        {/*
          Les chiffres ne s'affichent que pour une application en ligne : avant publication
          ils vaudraient zéro, et un zéro qui ne veut rien dire décourage pour rien.
        */}
        {published && stats !== null ? (
          <dl className="m-0 grid grid-cols-3 gap-2 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3 text-center">
            <Metric label="Visites" value={stats.views} />
            <Metric label="Inscrits" value={stats.signups} />
            <Metric label="Fiches" value={stats.records} />
            <dd className="col-span-3 m-0 text-xs text-[var(--color-ink-faint)]">
              sur {windowDays} jours
            </dd>
          </dl>
        ) : (
          <p className="m-0 text-xs text-[var(--color-ink-faint)]">
            {project.readyScore === null ? 'Pas encore testée' : `Prête à ${project.readyScore} %`}
          </p>
        )}

        {error !== null ? (
          <p className="m-0 text-xs text-[var(--color-critical)]">{error}</p>
        ) : null}
      </CardBody>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-line)] px-5 py-3 text-sm">
        {published && project.publicUrl !== null ? (
          <>
            <a
              href={project.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[var(--color-brand-strong)] no-underline"
            >
              Ouvrir
            </a>
            <button type="button" onClick={() => void copy()} className="text-[var(--color-ink-soft)]">
              {copied ? 'Adresse copiée' : 'Copier l’adresse'}
            </button>
          </>
        ) : null}
        {published && canLaunch ? (
          <a
            href={`/${locale}/projets/${project.id}/marketing`}
            className="font-medium text-[var(--color-brand-strong)] no-underline"
          >
            Lancement
          </a>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft(name)
            setRenaming(true)
          }}
          className="text-[var(--color-ink-soft)]"
        >
          Renommer
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="ml-auto text-[var(--color-ink-faint)]"
        >
          Supprimer
        </button>
      </div>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="m-0 text-xs text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 text-lg font-semibold">{value}</dd>
    </div>
  )
}
