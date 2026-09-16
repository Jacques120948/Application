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

type Library = {
  items: Media[]
  usedBytes: number
  quotaBytes: number
  visitorBytes: number
  generation: {
    provider: string | null
    providerLabel: string | null
    /** `creator` : sa clé, gratuit en crédits. `evoliia` : la nôtre, quota + crédits. */
    source: 'creator' | 'evoliia' | null
    dailyLimit: number
    dailyLeft: number
    monthlyLimit: number
    monthlyLeft: number
    creditsPerImage: number
  }
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

type Slot = { path: string; pageTitle: string; section: string; label: string; imageId?: string }

/**
 * Tous les emplacements d'image de l'application : un bandeau, une section image et
 * texte, chaque case d'une galerie, chaque membre d'une équipe, chaque logo, chaque
 * témoignage. L'image est posée là où elle sert, jamais déposée dans un dossier à charge
 * pour le créateur de comprendre ce qu'elle va devenir.
 */
function imageSlots(spec: AppSpec): Slot[] {
  const found: Slot[] = []
  spec.pages.forEach((page, pageIndex) => {
    page.blocks.forEach((block, blockIndex) => {
      const base = `pages[${pageIndex}].blocks[${blockIndex}]`
      const push = (path: string, section: string, label: string, imageId: string | undefined) =>
        found.push({ path, pageTitle: page.title, section, label, ...(imageId === undefined ? {} : { imageId }) })
      switch (block.type) {
        case 'hero':
          push(`${base}.imageId`, "Bandeau d'accueil", block.title, block.imageId)
          break
        case 'imageText':
          push(`${base}.imageId`, 'Image et texte', block.title, block.imageId)
          break
        case 'gallery':
          block.items.forEach((item, index) =>
            push(`${base}.items[${index}].imageId`, block.title ?? 'Galerie', item.caption ?? `Image ${index + 1}`, item.imageId),
          )
          break
        case 'team':
          block.members.forEach((member, index) =>
            push(`${base}.members[${index}].imageId`, block.title ?? 'Équipe', member.name, member.imageId),
          )
          break
        case 'logos':
          block.items.forEach((item, index) =>
            push(`${base}.items[${index}].imageId`, block.title ?? 'Partenaires', item.name, item.imageId),
          )
          break
        case 'testimonials':
          block.items.forEach((item, index) =>
            push(`${base}.items[${index}].imageId`, block.title ?? 'Témoignages', item.author, item.imageId),
          )
          break
        default:
          break
      }
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
  /** Génération : la description saisie, et l'emplacement qui recevra l'image. */
  const [prompt, setPrompt] = useState('')
  const [targetPath, setTargetPath] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const promptField = useRef<HTMLTextAreaElement>(null)

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

  /**
   * Une image générée avec la clé du créateur. Elle rejoint la bibliothèque comme une
   * photo téléversée et, si un emplacement était visé, s'y pose tout de suite.
   */
  async function generate() {
    if (prompt.trim().length < 5) return
    setGenerating(true)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/medias/generer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    const body = (await response.json().catch(() => ({}))) as { message?: string; media?: Media }
    setGenerating(false)
    if (!response.ok || body.media === undefined) {
      setError(body.message ?? "L'image n'a pas pu être créée.")
      return
    }
    const media = body.media
    await load()
    if (targetPath !== null) {
      await send('Image créée et posée', [{ op: 'set', path: targetPath, value: media.id }])
      setTargetPath(null)
    }
    setPrompt('')
  }

  function askFor(slot: Slot) {
    setTargetPath(slot.path)
    setPrompt(slot.label === slot.section ? slot.label : `${slot.label} — ${slot.section}`)
    promptField.current?.focus()
    promptField.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  const slots = imageSlots(spec)
  const used = library?.usedBytes ?? 0
  const quota = library?.quotaBytes ?? 0
  const visitor = library?.visitorBytes ?? 0
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
          {/*
            Les photos reçues des visiteurs ne figurent pas dans cette grille — elles
            appartiennent aux fiches de l'application, pas à la bibliothèque. Mais elles
            pèsent dans le quota, et sans cette ligne le créateur lirait « 30 Mo utilisés »
            en n'en voyant que cinq, et conclurait que le compteur ment.
          */}
          {visitor > 0 ? (
            <p className="m-0 mt-2 text-xs text-[var(--color-ink-faint)]">
              Dont {size(visitor)} de photos envoyées par vos visiteurs. Elles se consultent
              avec leur fiche, dans l’onglet Utilisateurs, et disparaissent avec elle.
            </p>
          ) : null}
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

      {library !== null && quota > 0 ? (
        <Card>
          <CardBody className="grid gap-3">
            <div>
              <h3 className="m-0 text-sm font-semibold">Créer une image avec l&apos;IA</h3>
              {/*
                Trois situations, et le créateur doit savoir laquelle est la sienne avant de
                cliquer : qui paie, et combien. Une image créée sans savoir qu'elle coûte huit
                crédits est une mauvaise surprise, et une mauvaise surprise sur de l'argent
                coûte plus cher que la fonction ne rapporte.
              */}
              {library.generation.source === 'creator' ? (
                <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">
                  Générée avec votre compte {library.generation.providerLabel}, facturée là-bas
                  quelques centimes l&apos;image — vos crédits Evoliia ne sont pas touchés. Il
                  vous reste {library.generation.dailyLeft} image(s) sur{' '}
                  {library.generation.dailyLimit} pour aujourd&apos;hui.
                </p>
              ) : null}
              {library.generation.source === 'evoliia' ? (
                <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">
                  Comprise dans votre offre : il vous reste{' '}
                  <strong>{library.generation.monthlyLeft} image(s) sur{' '}
                  {library.generation.monthlyLimit}</strong> ce mois-ci, et chacune coûte{' '}
                  {library.generation.creditsPerImage} crédits. Pour en créer davantage sans
                  limite, connectez votre propre clé depuis{' '}
                  <a href="/fr/connexions" className="text-[var(--color-brand-strong)]">
                    Connexions
                  </a>
                  .
                </p>
              ) : null}
              {library.generation.source === null ? (
                <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">
                  Votre offre ne comprend pas d&apos;images créées par l&apos;IA. Vous pouvez
                  connecter votre clé OpenAI ou Google Gemini depuis{' '}
                  <a href="/fr/connexions" className="text-[var(--color-brand-strong)]">
                    Connexions
                  </a>
                  {' '}: les images sont alors générées et facturées sur votre compte, jamais
                  sur vos crédits Evoliia.
                </p>
              ) : null}
            </div>
            {library.generation.source !== null ? (
              <>
                <textarea
                  ref={promptField}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="Un atelier de menuiserie baigné de lumière, établi en bois, copeaux au sol"
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={
                      generating ||
                      prompt.trim().length < 5 ||
                      library.generation.dailyLeft === 0 ||
                      (library.generation.source === 'evoliia' &&
                        library.generation.monthlyLeft === 0)
                    }
                    onClick={() => void generate()}
                  >
                    {generating ? 'Création en cours…' : 'Créer l’image'}
                  </Button>
                  {targetPath !== null ? (
                    <span className="text-xs text-[var(--color-ink-soft)]">
                      Elle sera posée sur l&apos;emplacement choisi.{' '}
                      <button type="button" className="underline" onClick={() => setTargetPath(null)}>
                        Annuler
                      </button>
                    </span>
                  ) : null}
                </div>
                <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                  Le style de votre application (couleurs, ambiance) est ajouté à votre description.
                  Pas de marque ni de personne réelle : le fournisseur refuserait.
                </p>
              </>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

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

      {slots.length === 0 ? null : (
        <Card>
          <CardBody className="grid gap-4">
            <div>
              <h3 className="m-0 text-sm font-semibold">Où vont vos images</h3>
              <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">
                Chaque emplacement ci-dessous attend une image. Sans image, un motif aux couleurs
                de votre application garde la place ; avec, c&apos;est votre photo qui fait la
                page. Sur un bandeau, elle passe sous un voile pour que le titre reste lisible.
              </p>
            </div>

            {slots.map((slot) => (
              <div key={slot.path} className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{slot.label}</span>
                  <Badge tone="neutral">{slot.section}</Badge>
                  <span className="text-xs text-[var(--color-ink-faint)]">{slot.pageTitle}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {library?.generation.source != null && library !== undefined ? (
                    <button
                      type="button"
                      disabled={busy || generating}
                      onClick={() => askFor(slot)}
                      className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-brand)] px-3 py-2 text-xs font-medium text-[var(--color-brand-strong)]"
                    >
                      Créer avec l’IA
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send('Image retirée', [{ op: 'delete', path: slot.path }])}
                    className={`rounded-[var(--radius-control)] border px-3 py-2 text-xs ${
                      slot.imageId === undefined
                        ? 'border-[var(--color-brand)] font-medium'
                        : 'border-[var(--color-line)]'
                    }`}
                  >
                    Sans image
                  </button>
                  {(library?.items ?? []).map((media) => (
                    <button
                      key={media.id}
                      type="button"
                      disabled={busy}
                      title={media.filename}
                      onClick={() =>
                        void send(`Image posée : ${slot.label}`, [
                          { op: 'set', path: slot.path, value: media.id },
                        ])
                      }
                      className={`overflow-hidden rounded-[var(--radius-control)] border-2 ${
                        slot.imageId === media.id
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
