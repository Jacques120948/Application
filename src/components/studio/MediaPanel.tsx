'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, CardBody, Notice } from '@/components/ui'
import type { AppSpec } from '@/server/spec/schema'
import type { PatchOperation } from '@/server/spec/patch'

/**
 * Bibliothèque d'images d'un projet.
 *
 * Deux partis pris. Le quota est affiché en permanence, pas seulement au moment où il est
 * atteint : une limite qu'on découvre en la heurtant ressemble à une panne. Et l'image est
 * posée là où elle sert, sur un bandeau précis, plutôt que déposée dans un dossier à
 * charge pour le créateur de comprendre ce qu'elle va devenir.
 */

type Media = {
  id: string
  filename: string
  width: number
  height: number
  bytes: number
  createdAt: string
}

type Library = { items: Media[]; usedBytes: number; quotaBytes: number }

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/** Bandeaux d'accueil de la spécification : les seuls endroits où une image se pose. */
function heroBlocks(spec: AppSpec) {
  const found: Array<{ path: string; pageTitle: string; title: string; imageId?: string }> = []
  spec.pages.forEach((page, pageIndex) => {
    page.blocks.forEach((block, blockIndex) => {
      if (block.type !== 'hero') return
      found.push({
        path: `pages[${pageIndex}].blocks[${blockIndex}].imageId`,
        pageTitle: page.title,
        title: block.title,
        ...(block.imageId === undefined ? {} : { imageId: block.imageId }),
      })
    })
  })
  return found
}

export function MediaPanel({
  projectId,
  spec,
  send,
}: {
  projectId: string
  spec: AppSpec
  send: (summary: string, operations: PatchOperation[]) => Promise<void>
}) {
  const [library, setLibrary] = useState<Library | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/medias`)
    const body = (await response.json()) as Library & { message?: string }
    if (!response.ok) {
      setError(body.message ?? 'La bibliothèque n’a pas pu être chargée.')
      return
    }
    setLibrary(body)
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(files: FileList | null) {
    if (files === null || files.length === 0) return
    setBusy(true)
    setError(null)
    for (const file of Array.from(files)) {
      const form = new FormData()
      form.append('image', file)
      const response = await fetch(`/api/projects/${projectId}/medias`, {
        method: 'POST',
        body: form,
      })
      const body = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(body.message ?? "L'envoi n'a pas abouti.")
        break
      }
    }
    setBusy(false)
    if (input.current !== null) input.current.value = ''
    await load()
  }

  async function remove(mediaId: string) {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/medias`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaId }),
    })
    const body = (await response.json()) as { message?: string }
    setBusy(false)
    if (!response.ok) {
      setError(body.message ?? "La suppression n'a pas abouti.")
      return
    }
    await load()
  }

  const heroes = heroBlocks(spec)
  const used = library?.usedBytes ?? 0
  const quota = library?.quotaBytes ?? 0
  const share = quota === 0 ? 0 : Math.min(100, Math.round((used / quota) * 100))

  return (
    <div className="grid gap-6">
      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      {quota === 0 ? (
        <Notice tone="neutral" title="Les images ne sont pas incluses dans votre offre">
          Votre application reste en ligne et garde son fond dégradé, construit à partir de
          vos couleurs.
        </Notice>
      ) : (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="m-0 text-sm font-semibold">Vos images</h3>
            <span className="text-xs text-[var(--color-ink-soft)]">
              {size(used)} sur {size(quota)}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${share}%`, background: 'var(--gradient-brand)' }}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
              multiple
              className="hidden"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Envoi…' : 'Ajouter des images'}
            </Button>
            <span className="text-xs text-[var(--color-ink-soft)]">
              8 Mo maximum par image. Elles sont recompressées et leurs données de prise de
              vue, dont le lieu, sont retirées.
            </span>
          </div>
        </div>
      )}

      {library !== null && library.items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {library.items.map((media) => (
            <figure key={media.id} className="m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/app/${projectId}/medias/${media.id}?format=thumb`}
                alt={media.filename}
                className="aspect-[4/3] w-full rounded-[var(--radius-control)] border border-[var(--color-line)] object-cover"
              />
              <figcaption className="mt-1.5 grid gap-1">
                <span className="truncate text-xs text-[var(--color-ink-soft)]">
                  {media.filename}
                </span>
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {media.width} × {media.height} · {size(media.bytes)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(media.id)}
                  className="justify-self-start text-xs text-[var(--color-critical)] underline"
                >
                  Supprimer
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {heroes.length === 0 ? null : (
        <Card>
          <CardBody className="grid gap-4">
            <div>
              <h3 className="m-0 text-sm font-semibold">Fond des bandeaux d’accueil</h3>
              <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">
                Une photo est posée derrière le titre, sous un voile aux couleurs de votre
                application pour que le texte reste lisible quelle que soit l’image.
              </p>
            </div>

            {heroes.map((hero) => (
              <div key={hero.path} className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{hero.title}</span>
                  <Badge tone="neutral">{hero.pageTitle}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void send('Fond du bandeau retiré', [{ op: 'delete', path: hero.path }])
                    }
                    className={`rounded-[var(--radius-control)] border px-3 py-2 text-xs ${
                      hero.imageId === undefined
                        ? 'border-[var(--color-brand)] font-medium'
                        : 'border-[var(--color-line)]'
                    }`}
                  >
                    Dégradé seul
                  </button>
                  {(library?.items ?? []).map((media) => (
                    <button
                      key={media.id}
                      type="button"
                      disabled={busy}
                      title={media.filename}
                      onClick={() =>
                        void send('Fond du bandeau modifié', [
                          { op: 'set', path: hero.path, value: media.id },
                        ])
                      }
                      className={`overflow-hidden rounded-[var(--radius-control)] border-2 ${
                        hero.imageId === media.id
                          ? 'border-[var(--color-brand)]'
                          : 'border-transparent'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/app/${projectId}/medias/${media.id}?format=thumb`}
                        alt={media.filename}
                        className="h-14 w-20 object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
