import type { ReactNode } from 'react'
import { getTranslator, type Locale } from '@/i18n'
import { Logo } from '@/components/marketing/Logo'
import { LogoutButton } from './LogoutButton'
import { CoachLauncher } from './CoachLauncher'

/** Cadre du studio : en-tête sobre, contenu centré (exigence 38). */
export function Shell({
  locale,
  userName,
  credits,
  isAdmin = false,
  screen = 'autre',
  children,
}: {
  locale: Locale
  userName?: string | null
  credits?: number
  /** Affiche l'entrée du back-office. Le lien ne donne aucun droit : le serveur décide. */
  isAdmin?: boolean
  /** Écran courant, transmis au coach pour qu'il situe la personne. */
  screen?: string
  children: ReactNode
}) {
  const t = getTranslator(locale)
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-5 py-3.5">
          <a
            href={`/${locale}/dashboard`}
            className="text-[var(--color-ink)] no-underline"
            aria-label={t('common.appName')}
          >
            <Logo id="mark-shell" size={28} wordmark={t('common.appName')} />
          </a>
          <nav className="flex items-center gap-4 text-sm">
            <a href={`/${locale}/dashboard`} className="text-[var(--color-ink-soft)] no-underline">
              {t('nav.dashboard')}
            </a>
            <a href={`/${locale}/idees`} className="text-[var(--color-ink-soft)] no-underline">
              {t('nav.ideas')}
            </a>
            {isAdmin ? (
              <a
                href={`/${locale}/administration`}
                className="text-[var(--color-ink-soft)] no-underline"
              >
                {t('nav.admin')}
              </a>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            {credits !== undefined ? (
              <span className="text-[var(--color-ink-soft)]">
                {t('dashboard.credits')} : <strong className="text-[var(--color-ink)]">{credits}</strong>
              </span>
            ) : null}
            {userName !== undefined && userName !== null ? (
              <span className="text-[var(--color-ink-soft)]">{userName}</span>
            ) : null}
            <LogoutButton label={t('nav.logout')} locale={locale} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-5 py-8">{children}</main>
      <CoachLauncher screen={screen} />
    </div>
  )
}
