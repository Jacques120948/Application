import type { ReactNode } from 'react'

/**
 * Gabarits partagés par toutes les sections d'une application créée.
 *
 * Une colonne de lecture, une bande alternée, un titre, une carte, un décor : c'est ce
 * qui fait qu'une page composée de sections différentes reste une seule page.
 */

/** Colonne de lecture. Tout ce qui n'est pas pleine largeur passe par elle. */
export function Column({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-5 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>{children}</div>
  )
}

/**
 * Section de contenu.
 *
 * Un fond alterné une section sur deux donne au défilement un rythme que des blocs
 * identiques empilés n'ont jamais. `reveal` est l'animation d'apparition définie dans la
 * feuille de style globale : elle ne coûte aucun JavaScript et se désactive d'elle-même
 * pour qui a demandé moins d'animations.
 */
export function Band({
  children,
  position,
  wide = false,
  tinted = false,
}: {
  children: ReactNode
  position: number
  wide?: boolean
  tinted?: boolean
}) {
  const alternate = tinted || position % 2 === 1
  return (
    <section
      className="app-section"
      style={alternate ? { background: 'var(--app-surface-alt)' } : undefined}
    >
      <Column wide={wide}>
        <div className="reveal">{children}</div>
      </Column>
    </section>
  )
}

/**
 * Décor d'un bandeau : le motif du thème, ou les deux halos lumineux.
 *
 * Tout est dessiné en CSS à partir des couleurs de l'application : rien à charger, et le
 * décor suit la palette au lieu de la contredire.
 */
export function Decor() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'var(--app-pattern)', backgroundSize: 'var(--app-pattern-size)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-32 h-96 w-96 rounded-full blur-3xl"
        style={{ background: 'var(--app-accent)', opacity: 'calc(0.4 * var(--app-pattern-blobs))' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-16 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ background: 'var(--app-surface)', opacity: 'calc(0.25 * var(--app-pattern-blobs))' }}
      />
    </>
  )
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="m-0 mb-6 text-balance text-2xl sm:text-3xl"
      style={{ fontWeight: 'var(--app-heading-weight)' }}
    >
      {children}
    </h2>
  )
}

/**
 * Grille dont le nombre de colonnes suit le nombre d'éléments.
 *
 * Une seule offre au milieu d'une grille de trois laisse un vide que rien ne justifie, et
 * c'est le genre de détail qui fait qu'une page « sent » le gabarit. Deux éléments se
 * mettent sur deux colonnes, un seul occupe la largeur qu'il mérite.
 */
export function columnsFor(count: number): string {
  if (count <= 1) return 'sm:max-w-md'
  if (count === 2) return 'sm:grid-cols-2'
  if (count === 4) return 'sm:grid-cols-2'
  return 'sm:grid-cols-2 lg:grid-cols-3'
}

/** Surface d'une carte : bordure discrète, fond, et une ombre teintée de la marque. */
export const CARD =
  'rounded-[var(--app-radius)] border p-6 transition-transform duration-200 hover:-translate-y-0.5'

export const cardStyle = {
  borderColor: 'var(--app-border)',
  background: 'var(--app-surface)',
  boxShadow: 'var(--app-shadow)',
} as const

