'use client'

import { useState, type ReactNode } from 'react'

/**
 * En-tête de la page publique.
 *
 * C'est le seul composant client de cette page, et il l'est pour une raison précise. La
 * version précédente était un `<details>` afin de n'envoyer aucun JavaScript ; mais un
 * `<summary>` doit être le premier enfant de son `<details>`, et comme la barre complète
 * le précédait, le navigateur en fabriquait un de lui-même, affichant le mot « Details »
 * en haut de la page. Un bouton avec son état annoncé coûte quelques lignes et se comporte
 * correctement au clavier comme au lecteur d'écran.
 *
 * L'action principale ne se replie jamais dans le menu : à toutes les largeurs elle reste
 * visible, là où on la cherche.
 */

export type NavLink = { label: string; href: string }

export function LandingHeader({
  links,
  loginLabel,
  loginHref,
  startLabel,
  startHref,
  menuLabel,
  brand,
}: {
  links: readonly NavLink[]
  loginLabel: string
  loginHref: string
  startLabel: string
  startHref: string
  menuLabel: string
  brand: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-surface)_88%,transparent)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-3">
        {brand}

        <nav aria-label={menuLabel} className="ml-6 hidden items-center gap-6 text-sm lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[var(--color-ink-soft)] no-underline transition-colors hover:text-[var(--color-brand-strong)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={loginHref}
            className="hidden px-3 py-2 text-sm font-medium text-[var(--color-ink-soft)] no-underline transition-colors hover:text-[var(--color-brand-strong)] sm:inline-flex"
          >
            {loginLabel}
          </a>
          <a
            href={startHref}
            className="inline-flex items-center justify-center rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-medium text-white no-underline shadow-[0_8px_20px_-10px_rgba(151,5,244,0.7)] transition hover:brightness-110"
            style={{ backgroundImage: 'var(--gradient-cta)' }}
          >
            {startLabel}
          </a>
          <button
            type="button"
            aria-label={menuLabel}
            aria-expanded={open}
            aria-controls="menu-mobile"
            onClick={() => setOpen((etait) => !etait)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-line)] text-[var(--color-ink-soft)] lg:hidden"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
              <path
                d={open ? 'M5 5l10 10M15 5L5 15' : 'M3 6h14M3 10h14M3 14h14'}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <nav
        id="menu-mobile"
        aria-label={menuLabel}
        hidden={!open}
        className="border-t border-[var(--color-line)] bg-[var(--color-surface)] lg:hidden"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-1 px-5 py-3">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-control)] px-2 py-3 text-base text-[var(--color-ink)] no-underline"
            >
              {link.label}
            </a>
          ))}
          <a
            href={loginHref}
            className="rounded-[var(--radius-control)] px-2 py-3 text-base text-[var(--color-ink-soft)] no-underline sm:hidden"
          >
            {loginLabel}
          </a>
        </div>
      </nav>
    </header>
  )
}
