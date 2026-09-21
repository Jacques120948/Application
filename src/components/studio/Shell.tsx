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
            href={`/${locale}/visibilite`}
            className="text-[var(--color-ink)] no-underline"
            aria-label={t('common.appName')}
          >
            <Logo id="mark-shell" size={28} wordmark={t('common.appName')} />
          </a>
          {/*
            Trois entrées, et c'est tout ce que le produit fait : analyser un site, brancher
            ce qu'on y relie, payer ce qu'on utilise. Les écrans du constructeur — idées,
            radar, équipe marketing, atelier — ont quitté ce menu quand Evoliia a cessé de
            vendre des applications. Ils existent toujours à leur adresse, pour les projets
            qui tournent encore ; un menu qui mène à un produit qu'on ne vend plus fait
            douter de celui qu'on vend.
          */}
          <nav className="flex items-center gap-4 text-sm">
            <a href={`/${locale}/visibilite`} className="text-[var(--color-ink-soft)] no-underline">
              {t('nav.visibility')}
            </a>
            {/*
              La publicité a sa propre entrée plutôt qu'un lien enfoui dans la visibilité :
              on n'y vient pas pour la même raison. La visibilité est ce qu'on gagne en
              écrivant mieux, la publicité est ce qu'on achète — et on la regarde le matin,
              parce qu'elle a dépensé pendant la nuit.
            */}
            <a href={`/${locale}/publicite`} className="text-[var(--color-ink-soft)] no-underline">
              Publicité
            </a>
            <a href={`/${locale}/connexions`} className="text-[var(--color-ink-soft)] no-underline">
              Connexions
            </a>
            <a href={`/${locale}/abonnement`} className="text-[var(--color-ink-soft)] no-underline">
              {t('nav.subscription')}
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
