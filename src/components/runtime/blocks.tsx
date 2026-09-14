'use client'

import type { ReactNode } from 'react'
import type { AppSpec, Block } from '@/server/spec/schema'
import { Icon } from './Icon'
import { Band, CARD, cardStyle, Column, columnsFor, Heading } from './layout'

/**
 * Sections de contenu d'une application créée.
 *
 * Toutes partagent trois règles. Une image absente n'est jamais un trou : un motif aux
 * couleurs de l'application prend sa place, et en aperçu il dit où l'ajouter. Aucun texte
 * n'est inséré en HTML brut. Et rien ne vient d'un serveur tiers, sauf la vidéo, dont
 * l'adresse est vérifiée par le schéma.
 */

type Extract<T extends Block['type']> = globalThis.Extract<Block, { type: T }>

export type BlockContext = {
  projectId: string
  basePath: string
  preview: boolean
}

export function imageUrl(projectId: string, imageId: string): string {
  return `/api/app/${projectId}/medias/${imageId}`
}

/**
 * Une image, ou sa place. Le cadre est toujours posé : c'est lui qui donne le rythme de la
 * section, l'image ne fait que le remplir.
 */
export function Picture({
  context,
  imageId,
  alt,
  ratio = 'aspect-[4/3]',
  className = '',
  rounded = 'rounded-[var(--app-radius-lg)]',
  onGradient = false,
}: {
  context: BlockContext
  imageId?: string
  alt: string
  ratio?: string
  className?: string
  rounded?: string
  /** Posée sur le dégradé du bandeau : le cadre vide doit y rester visible. */
  onGradient?: boolean
}) {
  if (imageId !== undefined) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl(context.projectId, imageId)}
        alt={alt}
        loading="lazy"
        className={`${ratio} ${rounded} w-full object-cover ${className}`}
        style={{ boxShadow: 'var(--app-shadow)' }}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className={`${ratio} ${rounded} relative isolate flex w-full items-center justify-center overflow-hidden ${className}`}
      style={
        onGradient
          ? {
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.35)',
              backdropFilter: 'blur(6px)',
              boxShadow: 'var(--app-shadow-lg)',
            }
          : {
              background: 'var(--app-primary-soft)',
              backgroundImage: 'var(--app-pattern)',
              backgroundSize: 'var(--app-pattern-size)',
              boxShadow: 'var(--app-shadow)',
            }
      }
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-40 blur-2xl"
        style={{ background: onGradient ? 'rgba(255,255,255,0.5)' : 'var(--app-accent)' }}
      />
      <span
        className="relative grid place-items-center gap-2 text-center"
        style={{ color: onGradient ? 'var(--app-on-gradient)' : 'var(--app-primary)' }}
      >
        <Icon name="image" size={30} />
        {context.preview ? (
          <span className="px-4 text-xs opacity-80">Ajoutez une image depuis l’onglet Images</span>
        ) : null}
      </span>
    </div>
  )
}

/** Initiales sur le dégradé de la marque, quand une personne n'a pas de photo. */
function Initials({ name, size = 'h-14 w-14 text-lg' }: { name: string; size?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${size} shrink-0 items-center justify-center rounded-full font-semibold`}
      style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)' }}
    >
      {initials}
    </span>
  )
}

function Avatar({ context, imageId, name, size }: { context: BlockContext; imageId?: string; name: string; size?: string }) {
  if (imageId === undefined) return <Initials name={name} size={size} />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl(context.projectId, imageId)}
      alt={name}
      loading="lazy"
      className={`${size ?? 'h-14 w-14'} shrink-0 rounded-full object-cover`}
      style={{ boxShadow: 'var(--app-shadow)' }}
    />
  )
}

export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-block rounded-full px-7 py-3.5 text-base font-semibold no-underline transition-transform duration-200 hover:-translate-y-0.5"
      style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)', boxShadow: 'var(--app-shadow)' }}
    >
      {children}
    </a>
  )
}

export function pageHrefOf(spec: AppSpec, basePath: string, pageId: string | undefined): string | undefined {
  if (pageId === undefined) return undefined
  const target = spec.pages.find((page) => page.id === pageId)
  return target ? `${basePath}/${target.path}` : undefined
}

// ───────────────────────────── Image et texte ─────────────────────────────

export function ImageTextBlock({
  block,
  spec,
  context,
  position,
}: {
  block: Extract<'imageText'>
  spec: AppSpec
  context: BlockContext
  position: number
}) {
  const href = pageHrefOf(spec, context.basePath, block.ctaPageId)
  const image = (
    <Picture context={context} imageId={block.imageId} alt={block.title} className="md:sticky md:top-24" />
  )
  const text = (
    <div className="flex flex-col justify-center">
      <h2
        className="m-0 text-balance text-2xl sm:text-3xl"
        style={{ fontWeight: 'var(--app-heading-weight)' }}
      >
        {block.title}
      </h2>
      <div className="mt-4 grid gap-3 text-lg leading-relaxed opacity-85">
        {block.body
          .split('\n')
          .filter(Boolean)
          .map((paragraph, index) => (
            <p key={index} className="m-0 text-pretty">
              {paragraph}
            </p>
          ))}
      </div>
      {block.ctaLabel !== undefined && href !== undefined ? (
        <div className="mt-7">
          <PrimaryButton href={href}>{block.ctaLabel}</PrimaryButton>
        </div>
      ) : null}
    </div>
  )
  return (
    <Band position={position} wide>
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
        {block.imagePosition === 'left' ? (
          <>
            {image}
            {text}
          </>
        ) : (
          <>
            <div className="md:order-2">{image}</div>
            <div className="md:order-1">{text}</div>
          </>
        )}
      </div>
    </Band>
  )
}

// ──────────────────────────────── Galerie ─────────────────────────────────

export function GalleryBlock({ block, context, position }: { block: Extract<'gallery'>; context: BlockContext; position: number }) {
  const cols = block.items.length <= 2 ? 'sm:grid-cols-2' : block.items.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3'
  return (
    <Band position={position} wide>
      {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
      <div className={`grid gap-4 ${cols}`}>
        {block.items.map((item, index) => (
          <figure key={index} className="m-0">
            <Picture context={context} imageId={item.imageId} alt={item.caption ?? ''} rounded="rounded-[var(--app-radius)]" />
            {item.caption !== undefined ? (
              <figcaption className="mt-2 text-sm opacity-70">{item.caption}</figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </Band>
  )
}

// ────────────────────────────── Témoignages ───────────────────────────────

export function TestimonialsBlock({ block, context, position }: { block: Extract<'testimonials'>; context: BlockContext; position: number }) {
  return (
    <Band position={position} wide>
      {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
      <div className={`grid gap-5 ${columnsFor(block.items.length)}`}>
        {block.items.map((item, index) => (
          <figure key={index} className={`${CARD} m-0 flex flex-col`} style={cardStyle}>
            <span
              aria-hidden="true"
              className="app-heading text-5xl leading-none"
              style={{ color: 'var(--app-primary)', fontWeight: 'var(--app-heading-weight)' }}
            >
              “
            </span>
            <blockquote className="m-0 mt-1 flex-1 text-pretty text-lg leading-relaxed opacity-90">
              {item.quote}
            </blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <Avatar context={context} imageId={item.imageId} name={item.author} size="h-11 w-11 text-sm" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{item.author}</span>
                {item.role !== undefined ? <span className="block truncate text-sm opacity-65">{item.role}</span> : null}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Band>
  )
}

// ──────────────────────────────── Étapes ──────────────────────────────────

export function StepsBlock({ block, position }: { block: Extract<'steps'>; position: number }) {
  const horizontal = block.items.length <= 4
  return (
    <Band position={position} wide>
      {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
      <ol className={`m-0 grid list-none gap-6 p-0 ${horizontal ? columnsFor(block.items.length) : 'max-w-2xl'}`}>
        {block.items.map((item, index) => (
          <li key={item.title} className={`relative flex gap-4 ${horizontal ? 'flex-col' : ''}`}>
            <span className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold"
                style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)', boxShadow: 'var(--app-shadow)' }}
              >
                {item.icon !== undefined ? <Icon name={item.icon} size={20} /> : index + 1}
              </span>
              {horizontal && index < block.items.length - 1 ? (
                <span aria-hidden="true" className="hidden h-px flex-1 sm:block" style={{ background: 'var(--app-border)' }} />
              ) : null}
            </span>
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-wider opacity-55">Étape {index + 1}</p>
              <h3 className="m-0 mt-1 text-lg" style={{ fontWeight: 'var(--app-heading-weight)' }}>
                {item.title}
              </h3>
              <p className="m-0 mt-1.5 leading-relaxed opacity-75">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Band>
  )
}

// ──────────────────────────────── Équipe ──────────────────────────────────

export function TeamBlock({ block, context, position }: { block: Extract<'team'>; context: BlockContext; position: number }) {
  return (
    <Band position={position} wide>
      {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
      <div className={`grid gap-5 ${columnsFor(block.members.length)}`}>
        {block.members.map((member) => (
          <div key={member.name} className={`${CARD} text-center`} style={cardStyle}>
            <div className="flex justify-center">
              <Avatar context={context} imageId={member.imageId} name={member.name} size="h-20 w-20 text-xl" />
            </div>
            <h3 className="m-0 mt-4 text-lg" style={{ fontWeight: 'var(--app-heading-weight)' }}>
              {member.name}
            </h3>
            <p className="m-0 mt-0.5 text-sm font-medium" style={{ color: 'var(--app-primary)' }}>
              {member.role}
            </p>
            {member.bio !== undefined ? <p className="m-0 mt-3 text-sm leading-relaxed opacity-75">{member.bio}</p> : null}
          </div>
        ))}
      </div>
    </Band>
  )
}

// ──────────────────────────────── Logos ───────────────────────────────────

export function LogosBlock({ block, context, position }: { block: Extract<'logos'>; context: BlockContext; position: number }) {
  return (
    <Band position={position} wide>
      {block.title !== undefined ? (
        <p className="m-0 mb-6 text-center text-sm font-semibold uppercase tracking-wider opacity-55">{block.title}</p>
      ) : null}
      <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-10 gap-y-6 p-0">
        {block.items.map((item) => (
          <li key={item.name} className="flex items-center">
            {item.imageId !== undefined ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(context.projectId, item.imageId)}
                alt={item.name}
                loading="lazy"
                className="h-10 w-auto max-w-40 object-contain opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0"
              />
            ) : (
              <span
                className="rounded-full border px-4 py-2 text-sm font-semibold opacity-80"
                style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface)' }}
              >
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Band>
  )
}

// ──────────────────────────────── Contact ─────────────────────────────────

export function ContactBlock({ block, position }: { block: Extract<'contact'>; position: number }) {
  const rows: Array<{ icon: string; label: string; value: string; href?: string }> = []
  if (block.email !== undefined) rows.push({ icon: 'mail', label: 'E-mail', value: block.email, href: `mailto:${block.email}` })
  if (block.phone !== undefined) rows.push({ icon: 'phone', label: 'Téléphone', value: block.phone, href: `tel:${block.phone.replace(/[^\d+]/g, '')}` })
  if (block.address !== undefined)
    rows.push({
      icon: 'pin',
      label: 'Adresse',
      value: block.address,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(block.address)}`,
    })
  if (block.hours !== undefined) rows.push({ icon: 'clock', label: 'Horaires', value: block.hours })
  return (
    <Band position={position} wide>
      <div className="grid gap-8 md:grid-cols-[1fr_1.2fr] md:gap-14">
        <div>
          {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
          {block.body !== undefined ? <p className="m-0 -mt-2 text-lg leading-relaxed opacity-80">{block.body}</p> : null}
        </div>
        <ul className="m-0 grid list-none gap-3 p-0">
          {rows.map((row) => (
            <li key={row.label} className={`${CARD} flex items-start gap-4`} style={cardStyle}>
              <span
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'var(--app-primary-soft)', color: 'var(--app-primary)' }}
              >
                <Icon name={row.icon} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wider opacity-55">{row.label}</span>
                {row.href !== undefined ? (
                  <a
                    href={row.href}
                    className="mt-0.5 block break-words font-medium no-underline"
                    style={{ color: 'var(--app-text)' }}
                    {...(row.href.startsWith('https://') ? { target: '_blank', rel: 'noreferrer' } : {})}
                  >
                    {row.value}
                  </a>
                ) : (
                  <span className="mt-0.5 block font-medium">{row.value}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Band>
  )
}

// ──────────────────────────────── Vidéo ───────────────────────────────────

/** Adresse d'intégration, sans cookie de suivi pour YouTube. */
export function embedUrl(url: string): string | null {
  const youtube = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/i)
  if (youtube?.[1]) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`
  const vimeo = url.match(/vimeo\.com\/(\d{6,})/i)
  if (vimeo?.[1]) return `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`
  return null
}

export function VideoBlock({ block, position }: { block: Extract<'video'>; position: number }) {
  const src = embedUrl(block.url)
  return (
    <Band position={position}>
      {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
      {src === null ? null : (
        <div
          className="aspect-video w-full overflow-hidden rounded-[var(--app-radius-lg)]"
          style={{ background: '#000', boxShadow: 'var(--app-shadow-lg)' }}
        >
          <iframe
            src={src}
            title={block.title ?? 'Vidéo'}
            loading="lazy"
            allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        </div>
      )}
      {block.caption !== undefined ? <p className="mt-3 text-sm opacity-70">{block.caption}</p> : null}
    </Band>
  )
}

// ─────────────────────────────── Comparatif ───────────────────────────────

function Cell({ value }: { value: string }) {
  const trimmed = value.trim()
  if (trimmed === '✓' || trimmed.toLowerCase() === 'oui') {
    return (
      <span className="inline-flex items-center justify-center" style={{ color: 'var(--app-primary)' }}>
        <Icon name="check" size={20} />
      </span>
    )
  }
  if (trimmed === '' || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'non') {
    return <span className="opacity-35">—</span>
  }
  return <span>{value}</span>
}

export function ComparisonBlock({ block, position }: { block: Extract<'comparison'>; position: number }) {
  return (
    <Band position={position} wide>
      {block.title !== undefined ? <Heading>{block.title}</Heading> : null}
      <div className="overflow-x-auto rounded-[var(--app-radius-lg)] border" style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface)', boxShadow: 'var(--app-shadow)' }}>
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr>
              <th className="p-4 text-sm font-medium opacity-60"> </th>
              {block.columns.map((column, index) => (
                <th
                  key={index}
                  className="p-4 text-center text-base"
                  style={{ fontWeight: 'var(--app-heading-weight)', color: index === 0 ? 'var(--app-primary)' : undefined }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t" style={{ borderColor: 'var(--app-border)' }}>
                <th scope="row" className="p-4 text-sm font-medium">
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td key={index} className="p-4 text-center text-sm">
                    <Cell value={value} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Band>
  )
}

// ──────────────────────────────── Bandeau ─────────────────────────────────

export function BannerBlock({ block, spec, context }: { block: Extract<'banner'>; spec: AppSpec; context: BlockContext }) {
  const href = pageHrefOf(spec, context.basePath, block.pageId) ?? block.href
  return (
    <div style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)' }}>
      <Column wide>
        <p className="m-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-3 text-center text-sm font-medium">
          <span>{block.text}</span>
          {block.label !== undefined && href !== undefined ? (
            <a
              href={href}
              className="rounded-full px-3 py-1 text-xs font-semibold no-underline"
              style={{ background: 'var(--app-surface)', color: 'var(--app-text)' }}
              {...(block.pageId === undefined ? { target: '_blank', rel: 'noreferrer' } : {})}
            >
              {block.label}
            </a>
          ) : null}
        </p>
      </Column>
    </div>
  )
}
