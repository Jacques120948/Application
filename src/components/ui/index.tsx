import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/**
 * Composants de base de la plateforme.
 *
 * Ils sont volontairement peu nombreux : l'interface doit rester lisible pour un
 * débutant (exigence 38). Aucun composant ne dépend du serveur ; tout arrive par props.
 */

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

// ─────────────────────────────── Bouton ──────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'medium' | 'large'

/**
 * Le bouton principal porte le dégradé de la marque plutôt qu'un aplat.
 *
 * `--gradient-cta` est l'étroit, du rose au violet, où un texte blanc reste lisible sur
 * toute la longueur ; le spectre complet ferait joli et rendrait le libellé illisible au
 * passage du jaune. Au survol, la luminosité monte légèrement : une transition de couleur
 * ne fonctionne pas sur un dégradé, un filtre si.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'text-white [background-image:var(--gradient-cta)] shadow-[0_8px_20px_-10px_rgba(151,5,244,0.7)] hover:brightness-110',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-line)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand-strong)]',
  ghost: 'bg-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-brand-strong)]',
  danger: 'bg-[var(--color-critical)] text-white hover:opacity-90',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  medium: 'px-4 py-2 text-sm',
  large: 'px-6 py-3 text-base',
}

export function Button({
  variant = 'primary',
  size = 'medium',
  className,
  ...props
}: ComponentPropsWithoutRef<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    />
  )
}

export function LinkButton({
  variant = 'primary',
  size = 'medium',
  className,
  ...props
}: ComponentPropsWithoutRef<'a'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <a
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition no-underline',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
    />
  )
}

// ──────────────────────────────── Carte ──────────────────────────────────────

export function Card({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cx(
        'rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]',
        className,
      )}
    />
  )
}

export function CardBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={cx('p-5', className)} />
}

// ──────────────────────────── Champ de saisie ────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[var(--color-ink)]">{label}</span>
      {children}
      {hint !== undefined && error === undefined ? (
        <span className="mt-1.5 block text-xs text-[var(--color-ink-soft)]">{hint}</span>
      ) : null}
      {error !== undefined ? (
        <span role="alert" className="mt-1.5 block text-xs text-[var(--color-critical)]">
          {error}
        </span>
      ) : null}
    </label>
  )
}

const CONTROL =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]'

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  return <input {...props} className={cx(CONTROL, className)} />
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  return <textarea {...props} className={cx(CONTROL, 'min-h-28 resize-y', className)} />
}

export function Select({ className, ...props }: ComponentPropsWithoutRef<'select'>) {
  return <select {...props} className={cx(CONTROL, className)} />
}

// ──────────────────────────────── Badge ──────────────────────────────────────

type Tone = 'neutral' | 'brand' | 'positive' | 'caution' | 'critical'

const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--color-canvas)] text-[var(--color-ink-soft)]',
  brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]',
  positive: 'bg-[var(--color-positive-soft)] text-[var(--color-positive)]',
  caution: 'bg-[var(--color-caution-soft)] text-[var(--color-caution)]',
  critical: 'bg-[var(--color-critical-soft)] text-[var(--color-critical)]',
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

// ─────────────────────────────── Messages ────────────────────────────────────

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone
  title?: string
  children: ReactNode
}) {
  return (
    <div className={cx('rounded-[var(--radius-card)] px-4 py-3 text-sm', TONES[tone])}>
      {title !== undefined ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  )
}

/**
 * Marqueur explicite d'une fonction non encore disponible (exigence 41).
 * Aucun bouton inerte : ce composant remplace le bouton et dit ce qui manque.
 */
export function ComingSoon({ what, when }: { what: string; when: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] px-4 py-3">
      <p className="text-sm font-medium text-[var(--color-ink)]">{what}</p>
      <p className="mt-0.5 text-xs text-[var(--color-ink-soft)]">Pas encore disponible — {when}.</p>
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] px-6 py-12 text-center">
      <p className="text-base font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-ink-soft)]">{body}</p>
      {action !== undefined ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
