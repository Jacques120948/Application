import type { ReactNode } from 'react'
import { getTranslator, type Locale } from '@/i18n'
import { Logo } from '@/components/marketing/Logo'
import { LogoutButton } from './LogoutButton'
import { CoachLauncher } from './CoachLauncher'
import { ContenuMenu, MenuMobile } from './Menu'

/**
 * Le cadre du studio : un menu permanent à gauche, le contenu à droite.
 *
 * Il a longtemps été une barre de quatre liens en haut, et le tableau de bord portait
 * dessous une grille de dix boutons intitulée « votre plan d'action ». Dix destinations à
 * plat, sans hiérarchie ni libellé qui dise à quoi elles servent : on y trouvait tout, et
 * rien du premier coup d'œil. Le reproche nous a été fait dans ces termes, et il était juste.
 *
 * Trois choses changent.
 *
 * **La navigation ne bouge plus d'un écran à l'autre.** On apprend où sont les choses une
 * fois, au lieu de rechercher à chaque page. C'est ce que fait n'importe quel outil qu'on
 * ouvre tous les jours, et ce que le produit ne faisait pas.
 *
 * **Elle est groupée et commentée.** Qui travaille pour vous, ce que ça donne, ce qu'on
 * règle une fois. Chaque entrée porte sa fonction en trois mots.
 *
 * **L'en-tête ne garde que ce qui n'est pas une destination** : l'identité du produit, le
 * solde de crédits, le nom, la sortie. Y remettre des liens dupliquerait le menu, et deux
 * navigations pour un seul produit, c'est une de trop.
 *
 * Le menu est large de seize rems et collant : une largeur fixe garde la lecture stable
 * d'un écran à l'autre, et un menu qui défile avec le contenu oblige à remonter pour
 * changer d'écran.
 */
export function Shell({
  locale,
  userName,
  credits,
  isAdmin = false,
  screen = 'autre',
  menu,
  siteId = '',
  children,
}: {
  locale: Locale
  userName?: string | null
  credits?: number
  /** Affiche l'entrée du back-office. Le lien ne donne aucun droit : le serveur décide. */
  isAdmin?: boolean
  /**
   * L'écran courant, tel que le coach le nomme.
   *
   * Sa liste est fermée côté serveur, et un nom inconnu y retombe sur « autre » — le coach
   * perdrait alors le contexte de la personne. C'est pourquoi le menu ne s'en sert pas.
   */
  screen?: string
  /**
   * L'entrée du menu à marquer comme courante, quand elle diffère de l'écran du coach.
   *
   * Les neuf pages de la visibilité partagent le même écran de coach, à raison : c'est le
   * même sujet. Mais le menu doit savoir laquelle des neuf est ouverte — sans quoi il
   * désignerait toujours la première, et savoir où l'on est fait la moitié du travail de
   * savoir où aller.
   */
  menu?: string
  /** Le site regardé, pour que les liens du menu n'en changent pas en chemin. */
  siteId?: string
  children: ReactNode
}) {
  const marque = menu ?? screen
  const t = getTranslator(locale)
  return (
    <div className="min-h-screen lg:flex">
      {/*
        La colonne de gauche n'existe qu'à partir du grand écran. En dessous, son contenu
        passe derrière le bouton « Menu » de l'en-tête : deux colonnes sur un téléphone
        laisseraient au contenu une largeur où rien ne se lit.
      */}
      <aside className="hidden w-64 shrink-0 border-r border-[var(--color-line)] bg-[var(--color-surface)] lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto pt-5">
          <a
            href={`/${locale}/visibilite`}
            className="mx-3 mb-5 block text-[var(--color-ink)] no-underline"
            aria-label={t('common.appName')}
          >
            <Logo id="mark-shell" size={26} wordmark={t('common.appName')} />
          </a>
          <ContenuMenu locale={locale} ecran={marque} siteId={siteId} isAdmin={isAdmin} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="relative border-b border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="flex w-full flex-wrap items-center gap-4 px-5 py-3">
            <a
              href={`/${locale}/visibilite`}
              className="text-[var(--color-ink)] no-underline lg:hidden"
              aria-label={t('common.appName')}
            >
              <Logo id="mark-entete" size={24} wordmark={t('common.appName')} />
            </a>

            <div className="ml-auto flex items-center gap-4 text-sm">
              {credits !== undefined ? (
                <span className="text-[var(--color-ink-soft)]">
                  {t('dashboard.credits')} :{' '}
                  <strong className="text-[var(--color-ink)]">{credits}</strong>
                </span>
              ) : null}
              {userName !== undefined && userName !== null ? (
                <span className="hidden text-[var(--color-ink-soft)] sm:inline">{userName}</span>
              ) : null}
              <LogoutButton label={t('nav.logout')} locale={locale} />
              <MenuMobile locale={locale} ecran={marque} siteId={siteId} isAdmin={isAdmin} />
            </div>
          </div>
        </header>

        <main className="w-full px-5 py-8">{children}</main>
      </div>

      <CoachLauncher screen={screen} />
    </div>
  )
}
