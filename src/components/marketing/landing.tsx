import type { ReactNode } from 'react'

/**
 * Pièces d'assemblage de la page publique.
 *
 * Elles vivent ici et non dans la page pour deux raisons. La page décrivait sa mise en
 * forme en même temps que son propos, sur neuf cents lignes où l'on ne retrouvait plus
 * rien ; et les mêmes formes revenaient recopiées d'une section à l'autre, si bien qu'un
 * réglage d'espacement se posait cinq fois et s'oubliait la sixième.
 *
 * Aucune chaîne visible n'est écrite ici : tout arrive par `props`, depuis le catalogue de
 * traduction (exigence 26). Aucune valeur du serveur n'y est importée non plus, seulement
 * des types — c'est la règle de dépendance vérifiée par tests/unit/architecture.test.ts.
 *
 * Les animations reposent sur la classe `.reveal` de globals.css : elles sont pilotées par
 * le défilement, sans une ligne de JavaScript, et s'effacent d'elles-mêmes lorsque la
 * personne a demandé moins d'animations.
 */

// ───────────────────────────── Éléments de base ──────────────────────────────

export function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className ?? 'mt-0.5 h-4 w-4 shrink-0'} aria-hidden="true">
      <path
        d="M4 10.5l4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Petit intitulé en capitales, au-dessus d'un titre ou d'un bloc. */
export function Eyebrow({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'light' }) {
  return (
    <span
      className={`text-xs font-medium uppercase tracking-wide ${
        tone === 'light' ? 'text-white/60' : 'text-[var(--color-ink-faint)]'
      }`}
    >
      {children}
    </span>
  )
}

/**
 * Section de la page.
 *
 * `tone` alterne le fond d'une section à l'autre : sans cette alternance, une page longue
 * devient un seul bloc où l'œil ne trouve plus où il en est.
 */
export function Section({
  id,
  title,
  titleAccent,
  body,
  tone = 'canvas',
  children,
}: {
  id?: string
  title: string
  /** Seconde ligne du titre, en dégradé. Sert aux sections qui portent une promesse. */
  titleAccent?: string
  body?: string
  tone?: 'canvas' | 'surface'
  children: ReactNode
}) {
  const shell =
    tone === 'surface'
      ? 'border-y border-[var(--color-line)] bg-[var(--color-surface)]'
      : 'bg-[var(--color-canvas)]'
  return (
    <section id={id} className={`scroll-mt-20 ${shell}`}>
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-20 lg:py-24">
        <h2 className="max-w-3xl text-balance text-[1.75rem] font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          {title}
          {titleAccent !== undefined ? (
            <>
              <br />
              <span className="text-gradient-brand">{titleAccent}</span>
            </>
          ) : null}
        </h2>
        {body !== undefined ? (
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--color-ink-soft)] sm:text-lg">
            {body}
          </p>
        ) : null}
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    </section>
  )
}

/**
 * Carte de la page publique.
 *
 * Le léger soulèvement au survol n'est pas un ornement : il indique ce qui répond au clic.
 * Les cartes qui ne mènent nulle part ne le portent pas.
 */
export function Panel({
  children,
  className,
  tone = 'surface',
  interactive = false,
  edge = false,
}: {
  children: ReactNode
  className?: string
  tone?: 'surface' | 'canvas'
  interactive?: boolean
  /** Filet dégradé sur l'arête supérieure. */
  edge?: boolean
}) {
  return (
    <div
      className={[
        'reveal rounded-[var(--radius-card)] border border-[var(--color-line)] p-6',
        tone === 'surface' ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-canvas)]',
        edge ? 'edge-brand pt-7' : '',
        interactive
          ? 'transition duration-200 hover:-translate-y-1 hover:border-[var(--color-brand)] hover:shadow-[0_22px_44px_-28px_rgba(151,5,244,0.55)]'
          : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}

// ──────────────────────── Le parcours, en un coup d'œil ──────────────────────

export type FlowStep = { title: string; body: string }

/**
 * Les cinq temps du parcours, alignés.
 *
 * Sur téléphone la rangée devient une colonne : cinq cartes côte à côte y seraient
 * illisibles, et une barre de défilement horizontale sur une page est toujours une erreur.
 * Les chevrons ne survivent qu'à partir de la rangée, puisqu'ils ne veulent plus rien dire
 * empilés.
 */
export function FlowRail({ steps }: { steps: readonly FlowStep[] }) {
  return (
    <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-5 md:gap-3">
      {steps.map((step, index) => (
        <li key={step.title} className="relative">
          {index > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 -left-2.5 hidden -translate-y-1/2 text-[var(--color-ink-faint)] md:block"
            >
              ›
            </span>
          ) : null}
          <div className="reveal h-full rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ background: 'var(--gradient-cta)' }}
            >
              {index + 1}
            </span>
            <h3 className="mt-3 mb-0 text-sm font-semibold">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// ─────────────────────────── Les portes d'entrée ─────────────────────────────

export type Door = { title: string; body: string; cta: string; href: string }

export function DoorCards({ doors }: { doors: readonly Door[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {doors.map((door, index) => (
        <Panel key={door.title} interactive className="flex flex-col">
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: 'var(--gradient-cta)' }}
          >
            {index + 1}
          </span>
          <h3 className="mt-4 mb-0 text-lg font-semibold text-balance">{door.title}</h3>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">{door.body}</p>
          <a
            href={door.href}
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-strong)] no-underline"
          >
            {door.cta}
            <span aria-hidden="true">→</span>
          </a>
        </Panel>
      ))}
    </div>
  )
}

// ────────────────────────────── La chronologie ───────────────────────────────

/**
 * De l'idée à l'acquisition, avec le repère de ce que couvre Evoliia.
 *
 * Les étapes s'enroulent au lieu de défiler : une chronologie qui déborde de l'écran ne se
 * lit pas sur un téléphone, et rien n'y est perdu à passer à la ligne.
 */
export function Timeline({
  steps,
  covered,
  others,
}: {
  steps: readonly string[]
  /** Ce qu'Evoliia couvre. Affiché en couleur de marque. */
  covered: string
  /** Là où commence un outil qui ne fait que construire. Volontairement discret. */
  others: string
}) {
  return (
    <div className="reveal">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-3 p-0">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-[var(--color-ink-faint)]">
                →
              </span>
            ) : null}
            <span
              className="rounded-[var(--radius-pill)] px-3.5 py-1.5 text-xs font-semibold tracking-wide text-white sm:text-sm"
              style={{ background: 'var(--gradient-cta)' }}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 mb-0 flex gap-2 text-sm font-medium text-[var(--color-brand-strong)]">
        <span
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ background: 'var(--gradient-cta)' }}
        />
        {covered}
      </p>
      <p className="mt-2 mb-0 flex gap-2 text-sm text-[var(--color-ink-faint)]">
        <span
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-line)]"
        />
        {others}
      </p>
    </div>
  )
}

// ──────────────────────────── Les démonstrations ─────────────────────────────

export type DemoCardData = {
  slug: string
  name: string
  category: string
  summary: string
  priceLabel: string
  shot: string
  shotAlt: string
}

/**
 * Galerie des démonstrations.
 *
 * La grille est régulière. Une première carte à cheval sur deux colonnes avait été
 * essayée, pour donner un point d'entrée à l'œil : elle rendait sa capture deux fois plus
 * haute que les autres, et laissait à côté d'elle un vide de la hauteur d'un écran. Six
 * captures de même taille se comparent mieux, et c'est ce qu'on vient y faire.
 */
export function DemoGallery({
  demos,
  openLabel,
  createLabel,
  createHref,
}: {
  demos: readonly DemoCardData[]
  openLabel: string
  createLabel: string
  createHref: string
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {demos.map((demo, index) => (
        <article
          key={demo.slug}
          className={[
            'reveal group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]',
            'transition duration-200 hover:-translate-y-1 hover:border-[var(--color-brand)] hover:shadow-[0_26px_52px_-30px_rgba(151,5,244,0.55)]',
          ].join(' ')}
        >
          <div className="overflow-hidden border-b border-[var(--color-line)]">
            <img
              src={demo.shot}
              alt={demo.shotAlt}
              width={1280}
              height={860}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className="block h-auto w-full transition duration-500 group-hover:scale-[1.03]"
            />
          </div>
          <div className="flex flex-1 flex-col p-5">
            <Eyebrow>{demo.category}</Eyebrow>
            <h3 className="mt-2 mb-0 text-lg font-semibold">{demo.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {demo.summary}
            </p>
            <p className="mt-3 mb-0 text-sm font-medium text-[var(--color-brand-strong)]">
              {demo.priceLabel}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
              <a
                href={`/a/${demo.slug}`}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-strong)] no-underline"
              >
                {openLabel}
                <span aria-hidden="true">→</span>
              </a>
              <a
                href={createHref}
                className="text-sm text-[var(--color-ink-soft)] no-underline hover:text-[var(--color-brand-strong)]"
              >
                {createLabel}
              </a>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

// ─────────────────────────── Les temps du parcours ───────────────────────────

export type NumberedStep = { title: string; body: string }

/** Étapes numérotées, en deux colonnes à partir de la tablette. */
export function NumberedSteps({ steps }: { steps: readonly NumberedStep[] }) {
  return (
    <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
      {steps.map((step, index) => (
        <li key={step.title}>
          <div className="reveal flex h-full gap-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 sm:p-6">
            <span
              aria-hidden="true"
              className="text-gradient-brand shrink-0 text-2xl font-semibold tabular-nums"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <h3 className="m-0 text-base font-semibold">{step.title}</h3>
              <p className="mt-1.5 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {step.body}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

// ────────────────────────────── Liste cochée ─────────────────────────────────

export function CheckList({
  items,
  className,
}: {
  items: readonly string[]
  className?: string
}) {
  return (
    <ul className={`m-0 grid list-none gap-3 p-0 ${className ?? ''}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
          <span className="text-[var(--color-brand)]">
            <Check />
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}
