'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AppSpec } from '@/server/spec/schema'
import type { CheckReport } from '@/server/spec/checks'
import type { PatchOperation } from '@/server/spec/patch'
import { Badge, Button, Card, CardBody, ComingSoon, Notice } from '@/components/ui'
import { ChatPanel } from './ChatPanel'
import { ChecksPanel, DesignPanel, FeaturesPanel, MonetizationPanel } from './panels'
import { DataPanel } from './DataPanel'
import { SalesPanel } from './SalesPanel'
import { MediaPanel } from './MediaPanel'
import { ProgressSteps } from './ProgressSteps'
import { SupportPanel } from './SupportPanel'

/**
 * Espace de travail d'un projet (sections 6, 7 et 28).
 *
 * Disposition : conversation à gauche, aperçu réel au centre, réglages simples à droite.
 * L'aperçu est un `iframe` cloisonné qui affiche la véritable application, pas une image.
 */

type Message = { id: string; role: 'USER' | 'ASSISTANT' | 'SYSTEM'; content: string }

type DataOverview = {
  endUserCount: number
  models: Array<{
    id: string
    label: string
    count: number
    recent: Array<{ id: string; createdAt: string; summary: string }>
  }>
}

type Version = {
  id: string
  number: number
  label: string
  source: string
  createdAt: string
  isCurrent: boolean
  isPublished: boolean
}

type Tab =
  | 'assistant'
  | 'design'
  | 'medias'
  | 'features'
  | 'users'
  | 'monetization'
  | 'tests'
  | 'publish'
  | 'versions'
  | 'support'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'assistant', label: "Modifier avec l'IA" },
  { id: 'design', label: 'Design' },
  { id: 'medias', label: 'Images' },
  { id: 'features', label: 'Fonctionnalités' },
  { id: 'users', label: 'Utilisateurs' },
  { id: 'monetization', label: 'Monétisation' },
  { id: 'tests', label: 'Tests' },
  { id: 'publish', label: 'Publication' },
  { id: 'versions', label: 'Versions' },
  { id: 'support', label: 'Support' },
]

const DEVICES = {
  phone: { label: 'Téléphone', width: 390, height: 780 },
  tablet: { label: 'Tablette', width: 768, height: 900 },
  desktop: { label: 'Ordinateur', width: 1200, height: 800 },
} as const

type DeviceKey = keyof typeof DEVICES

export function ProjectWorkspace({
  projectId,
  locale,
  initialSpec,
  initialReport,
  initialMessages,
  publishedUrl,
  aiAvailable,
  alreadyTested,
  initialTab = 'assistant',
  support,
}: {
  projectId: string
  locale: string
  /** Onglet ouvert à l'arrivée, par exemple depuis une notification (`?onglet=support`). */
  initialTab?: Tab
  /** Lia : le drapeau de la V2 et les coûts annoncés. L'accès est lu par le panneau lui-même. */
  support: { liaV2: boolean; faqCredits: number; insightsCredits: number }
  initialSpec: AppSpec
  initialReport: CheckReport
  initialMessages: Message[]
  publishedUrl: string | null
  aiAvailable: boolean
  /** Un test a déjà été enregistré pour ce projet lors d'une session précédente. */
  alreadyTested: boolean
}) {
  const router = useRouter()
  const [spec, setSpec] = useState(initialSpec)
  const [report, setReport] = useState<CheckReport>(initialReport)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [builderDraft, setBuilderDraft] = useState('')
  const [device, setDevice] = useState<DeviceKey>('phone')
  const [previewKey, setPreviewKey] = useState(0)
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [data, setData] = useState<DataOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const [tested, setTested] = useState(alreadyTested)
  const [error, setError] = useState<string | null>(null)
  const [publishedAt, setPublishedAt] = useState(publishedUrl)

  const reloadPreview = useCallback(() => setPreviewKey((value) => value + 1), [])

  const loadVersions = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/versions`)
    if (!response.ok) return
    const body = (await response.json()) as { versions: Version[] }
    setVersions(body.versions)
  }, [projectId])

  const loadData = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/donnees`)
    if (!response.ok) return
    setData((await response.json()) as DataOverview)
  }, [projectId])

  useEffect(() => {
    if (tab === 'versions') void loadVersions()
    if (tab === 'users') void loadData()
  }, [tab, loadVersions, loadData])

  const sendPatch = useCallback(
    async (summary: string, operations: PatchOperation[]) => {
      setError(null)
      const response = await fetch(`/api/projects/${projectId}/spec`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary, operations }),
      })
      const body = (await response.json()) as { spec?: AppSpec; message?: string }
      if (!response.ok || body.spec === undefined) {
        setError(body.message ?? "La modification n'a pas pu être appliquée.")
        return
      }
      setSpec(body.spec)
      reloadPreview()
      router.refresh()
    },
    [projectId, reloadPreview, router],
  )

  async function runChecks() {
    setBusy(true)
    const response = await fetch(`/api/projects/${projectId}/checks`, { method: 'POST' })
    const body = (await response.json()) as CheckReport & { message?: string }
    setBusy(false)
    if (!response.ok) {
      setError(body.message ?? "Le test n'a pas pu être lancé.")
      return
    }
    setReport(body)
    setTested(true)
  }

  async function publish() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/publish`, { method: 'POST' })
    const body = (await response.json()) as { url?: string; message?: string }
    setBusy(false)
    if (!response.ok) {
      setError(body.message ?? "La publication n'a pas abouti.")
      return
    }
    setPublishedAt(body.url ?? null)
    router.refresh()
  }

  async function restore(versionId: string) {
    setBusy(true)
    const response = await fetch(
      `/api/projects/${projectId}/versions/${versionId}/restore`,
      { method: 'POST' },
    )
    const body = (await response.json()) as { spec?: AppSpec; message?: string }
    setBusy(false)
    if (!response.ok || body.spec === undefined) {
      setError(body.message ?? "La restauration n'a pas abouti.")
      return
    }
    setSpec(body.spec)
    reloadPreview()
    void loadVersions()
    router.refresh()
  }

  const size = DEVICES[device]

  return (
    <div className="grid gap-5">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4 py-4">
          <div>
            <h1 className="m-0 text-xl font-semibold">{spec.name}</h1>
            <p className="m-0 mt-0.5 text-sm text-[var(--color-ink-soft)]">{spec.tagline}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Badge tone={report.counts.error === 0 ? 'positive' : 'caution'}>
              Prête à {report.score} %
            </Badge>
            {publishedAt !== null ? (
              <a
                href={publishedAt}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[var(--color-brand)]"
              >
                Voir en ligne
              </a>
            ) : null}
          </div>
        </CardBody>
        <div className="border-t border-[var(--color-line)] px-5 py-3">
          <ProgressSteps
            spec={spec}
            report={report}
            published={publishedAt !== null}
            tested={tested}
          />
        </div>
      </Card>

      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Colonne gauche : outils */}
        {/* Hauteur bornée : le panneau défile en interne au lieu d'allonger la page et
            de repousser l'aperçu hors de l'écran. */}
        <Card className="flex h-[min(78vh,46rem)] flex-col overflow-hidden">
          <div className="flex flex-wrap gap-1 border-b border-[var(--color-line)] p-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={
                  item.id === tab
                    ? 'rounded-[var(--radius-control)] bg-[var(--color-brand-soft)] px-3 py-1.5 text-sm font-medium text-[var(--color-brand-strong)]'
                    : 'rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'assistant' ? (
              aiAvailable ? (
                <ChatPanel
                  projectId={projectId}
                  initialMessages={initialMessages}
                  initialDraft={builderDraft}
                  onApplied={() => {
                    reloadPreview()
                    router.refresh()
                  }}
                />
              ) : (
                <div className="p-4">
                  <Notice tone="caution" title="Assistant non configuré">
                    Cette installation n&apos;a pas de clé d&apos;accès au modèle. Vous pouvez
                    modifier votre application depuis les onglets Design, Fonctionnalités et
                    Monétisation.
                  </Notice>
                </div>
              )
            ) : null}

            {tab === 'design' ? (
              <div className="p-4">
                <DesignPanel spec={spec} send={sendPatch} />
              </div>
            ) : null}

            {tab === 'medias' ? (
              <div className="p-4">
                <MediaPanel projectId={projectId} spec={spec} send={sendPatch} />
              </div>
            ) : null}

            {tab === 'features' ? (
              <div className="p-4">
                <FeaturesPanel spec={spec} send={sendPatch} />
              </div>
            ) : null}

            {tab === 'users' ? (
              <div className="p-4">
                {data === null ? (
                  <p className="text-sm text-[var(--color-ink-soft)]">Chargement…</p>
                ) : (
                  /*
                    Les modèles viennent de la spécification en cours, non de la réponse du
                    serveur : c'est elle qui décrit les champs, et le panneau doit pouvoir
                    afficher et corriger chacun d'eux.
                  */
                  <DataPanel
                    projectId={projectId}
                    models={spec.dataModels}
                    endUserCount={data.endUserCount}
                    locale={locale}
                  />
                )}
              </div>
            ) : null}

            {tab === 'monetization' ? (
              <div className="p-4">
                <MonetizationPanel spec={spec} send={sendPatch} />
                <div className="mt-5">
                  <SalesPanel projectId={projectId} locale={locale} />
                </div>
              </div>
            ) : null}

            {tab === 'tests' ? (
              <div className="p-4">
                <ChecksPanel report={report} running={busy} onRun={() => void runChecks()} />
              </div>
            ) : null}

            {tab === 'publish' ? (
              <div className="grid gap-4 p-4">
                {publishedAt !== null ? (
                  <Notice tone="positive" title="Votre application est en ligne">
                    <a href={publishedAt} target="_blank" rel="noreferrer">
                      {publishedAt}
                    </a>
                  </Notice>
                ) : null}
                {report.counts.error > 0 ? (
                  <Notice tone="caution" title="Un point bloque encore la publication">
                    Lancez le test pour voir ce qu&apos;il reste à corriger.
                  </Notice>
                ) : null}
                <Button size="large" onClick={() => void publish()} disabled={busy}>
                  {busy ? 'Publication…' : 'Publier mon application'}
                </Button>
                <p className="text-sm text-[var(--color-ink-soft)]">
                  Publier met en ligne la version actuelle. Vos modifications suivantes ne sont
                  visibles qu&apos;après une nouvelle publication.
                </p>
                <ComingSoon
                  what="Connecter votre propre nom de domaine"
                  when="prévu en phase 2 — en attendant, votre application vit à son adresse evoliia.com/a/…"
                />
              </div>
            ) : null}

            {tab === 'support' ? (
              <SupportPanel
                projectId={projectId}
                locale={locale}
                liaV2={support.liaV2}
                faqCredits={support.faqCredits}
                insightsCredits={support.insightsCredits}
                onSendToBuilder={(text) => {
                  setBuilderDraft(text)
                  setTab('assistant')
                }}
              />
            ) : null}

            {tab === 'versions' ? (
              <div className="p-4">
                {versions === null ? (
                  <p className="text-sm text-[var(--color-ink-soft)]">Chargement…</p>
                ) : (
                  <ul className="grid gap-2 p-0 text-sm list-none">
                    {versions.map((version) => (
                      <li
                        key={version.id}
                        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5"
                      >
                        <div>
                          <p className="m-0 font-medium">
                            Version {version.number} — {version.label}
                          </p>
                          <p className="m-0 text-xs text-[var(--color-ink-soft)]">
                            {new Date(version.createdAt).toLocaleString(locale)}
                          </p>
                        </div>
                        <span className="ml-auto flex items-center gap-2">
                          {version.isPublished ? <Badge tone="positive">En ligne</Badge> : null}
                          {version.isCurrent ? <Badge tone="brand">Actuelle</Badge> : null}
                          {!version.isCurrent ? (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void restore(version.id)}
                            >
                              Restaurer
                            </Button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </Card>

        {/* Colonne droite : aperçu réel */}
        <div className="grid content-start gap-3 self-start lg:sticky lg:top-4">
          <div className="flex gap-1">
            {(Object.keys(DEVICES) as DeviceKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setDevice(key)}
                className={
                  key === device
                    ? 'rounded-[var(--radius-control)] bg-[var(--color-brand-soft)] px-3 py-1.5 text-sm font-medium text-[var(--color-brand-strong)]'
                    : 'rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)]'
                }
              >
                {DEVICES[key].label}
              </button>
            ))}
          </div>

          <div className="overflow-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <iframe
              key={previewKey}
              title="Aperçu de votre application"
              src={`/preview/${projectId}`}
              // L'aperçu exécute le runtime de l'application dans un contexte restreint.
              sandbox="allow-scripts allow-forms allow-same-origin"
              style={{
                width: size.width,
                height: size.height,
                maxWidth: '100%',
                border: '1px solid var(--color-line)',
                borderRadius: 12,
                background: '#fff',
              }}
            />
          </div>
          <p className="text-xs text-[var(--color-ink-soft)]">
            Cet aperçu est votre application réelle, pas une image. Les formulaires
            enregistrent vraiment des données.
          </p>
        </div>
      </div>
    </div>
  )
}
