import type { ReactNode } from 'react'

/**
 * Cadres d'appareil pour les captures d'applications.
 *
 * Les images sont de vraies captures des démonstrations publiées ; le cadre sert
 * uniquement à indiquer sur quel écran on les regarde. Aucune image n'est décorative :
 * chacune porte un texte alternatif décrivant l'application montrée.
 *
 * Les dimensions sont posées sur l'image pour réserver la place avant chargement : sans
 * elles, la page saute pendant le défilement.
 */

export function BrowserFrame({
  src,
  alt,
  caption,
  priority = false,
  className,
}: {
  src: string
  alt: string
  caption?: string
  /** Vrai pour les captures visibles d'emblée : elles ne doivent pas être différées. */
  priority?: boolean
  className?: string
}) {
  return (
    <figure
      className={`m-0 overflow-hidden rounded-[var(--radius-card)] border border-black/10 bg-white shadow-[0_24px_60px_-32px_rgba(14,18,53,0.55)] ${className ?? ''}`}
    >
      <div className="flex items-center gap-1.5 border-b border-black/5 bg-[#f4f5fb] px-3 py-2">
        <Dot color="#ff5f57" />
        <Dot color="#febc2e" />
        <Dot color="#28c840" />
        {caption !== undefined ? (
          <span className="ml-2 truncate text-[11px] text-[#6b7392]">{caption}</span>
        ) : null}
      </div>
      <img
        src={src}
        alt={alt}
        width={1280}
        height={860}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        className="block h-auto w-full"
      />
    </figure>
  )
}

export function PhoneFrame({
  src,
  alt,
  className,
  cropHeight,
}: {
  src: string
  alt: string
  className?: string
  /** Hauteur maximale de la capture, en pixels. Au-delà, l'image est coupée par le bas. */
  cropHeight?: number
}) {
  return (
    <figure
      className={`m-0 overflow-hidden rounded-[28px] border-[6px] border-[#11162f] bg-[#11162f] shadow-[0_30px_60px_-30px_rgba(14,18,53,0.7)] ${className ?? ''}`}
    >
      <img
        src={src}
        alt={alt}
        width={390}
        height={780}
        loading="lazy"
        decoding="async"
        style={cropHeight === undefined ? undefined : { maxHeight: `${cropHeight}px` }}
        className={`block w-full rounded-[22px] ${
          cropHeight === undefined ? 'h-auto' : 'object-cover object-top'
        }`}
      />
    </figure>
  )
}

function Dot({ color }: { color: string }): ReactNode {
  return <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />
}
