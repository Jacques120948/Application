'use client'

import { useState } from 'react'
import { MEMBRES } from '@/lib/equipe'

/**
 * Le menu du studio, et pourquoi il a remplacé une barre de liens.
 *
 * L'ancienne navigation était une rangée de quatre liens en haut, et le tableau de bord
 * portait dessous une grille de dix boutons intitulée « votre plan d'action ». Dix
 * destinations offertes à plat, sans hiérarchie ni libellé qui dise à quoi elles servent :
 * on y trouvait tout, et rien du premier coup d'œil. C'est le reproche exact qui nous a été
 * fait, et il était juste.
 *
 * Trois principes remplacent ça.
 *
 * **La navigation est permanente et groupée.** Elle ne bouge pas d'un écran à l'autre, ce
 * qui permet d'apprendre où sont les choses une fois pour toutes. Trois groupes nommés :
 * qui travaille pour vous, ce que ça donne, et ce qu'on règle une fois.
 *
 * **Chaque entrée dit ce qu'elle fait.** « Gia — Moteurs IA » se comprend sans l'ouvrir ;
 * « Assistants » ne se comprend qu'après. Un intitulé de fonction coûte une ligne et
 * épargne un aller-retour.
 *
 * **L'écran courant se voit.** Savoir où l'on est fait la moitié du travail de savoir où
 * aller. C'est le serveur qui le dit, par `ecran` : le calculer ici demanderait de lire
 * l'adresse au montage et donnerait un menu qui clignote au premier affichage.
 *
 * Sur téléphone, il se replie derrière un bouton — la largeur ne permet pas deux colonnes,
 * et un menu qui prend l'écran entier avant le contenu fait fermer l'onglet.
 */

type Entree = {
  /** Ce qui s'affiche. Un nom, jamais un verbe : on nomme une destination. */
  nom: string
  /** À quoi elle sert, en trois mots. C'est ce qui évite d'ouvrir pour voir. */
  quoi: string
  href: string
  /** L'écran qu'elle désigne, pour se savoir courante. */
  ecran: string
  /** Le portrait du membre, quand l'entrée en désigne un. */
  avatar?: string
}

/** Une pastille de couleur quand il n'y a pas de portrait. */
const TEINTES: Record<string, string> = {
  brand: 'var(--color-brand-soft)',
  accent: 'var(--color-accent-soft, var(--color-brand-soft))',
  warm: 'var(--color-caution-soft)',
  night: 'var(--color-canvas)',
  sun: 'var(--color-caution-soft)',
  sea: 'var(--color-positive-soft)',
}

function Pastille({ entree, teinte }: { entree: Entree; teinte: string }) {
  if (entree.avatar === undefined) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ backgroundColor: TEINTES[teinte] ?? 'var(--color-canvas)' }}
      >
        {entree.nom.slice(0, 1)}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={entree.avatar}
      alt=""
      width={28}
      height={28}
      className="h-7 w-7 shrink-0 rounded-full object-cover"
    />
  )
}

function Groupe({
  titre,
  entrees,
  courant,
  teintes,
}: {
  titre: string
  entrees: readonly Entree[]
  courant: string
  teintes?: Record<string, string>
}) {
  if (entrees.length === 0) return null
  return (
    <div className="mt-6 first:mt-0">
      <p className="m-0 px-3 text-[11px] font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
        {titre}
      </p>
      <ul className="m-0 mt-2 grid list-none gap-0.5 p-0">
        {entrees.map((entree) => {
          const actif = entree.ecran === courant
          return (
            <li key={entree.href}>
              <a
                href={entree.href}
                aria-current={actif ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 no-underline ${
                  actif
                    ? 'bg-[var(--color-brand-soft)] text-[var(--color-ink)]'
                    : 'text-[var(--color-ink)] hover:bg-[var(--color-canvas)]'
                }`}
              >
                <Pastille entree={entree} teinte={teintes?.[entree.ecran] ?? 'brand'} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{entree.nom}</span>
                  <span className="block truncate text-xs text-[var(--color-ink-soft)]">
                    {entree.quoi}
                  </span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Où mène chaque membre de l'équipe.
 *
 * Trois d'entre eux ont leur propre écran, parce qu'ils y montrent des chiffres ; les trois
 * autres mènent à la conversation, qui est tout ce qu'ils savent faire aujourd'hui. On ne
 * fabrique pas d'écran vide pour l'uniformité du menu.
 */
function destinations(locale: string, siteId: string): Entree[] {
  const site = siteId === '' ? '' : `?siteId=${siteId}`
  const versEquipe = (id: string) =>
    `/${locale}/visibilite/equipe${site === '' ? `?agent=${id}` : `${site}&agent=${id}`}`

  const propres: Record<string, { href: string; ecran: string }> = {
    audit: { href: `/${locale}/visibilite`, ecran: 'visibilite' },
    geo: { href: `/${locale}/visibilite/assistants${site}`, ecran: 'assistants' },
    content: { href: `/${locale}/visibilite/articles${site}`, ecran: 'articles' },
    ads: { href: `/${locale}/publicite`, ecran: 'publicite' },
    meta: { href: `/${locale}/publicite/meta`, ecran: 'publicite-meta' },
  }

  return MEMBRES.map((membre) => ({
    nom: membre.name,
    quoi: membre.role,
    avatar: membre.avatar,
    href: propres[membre.id]?.href ?? versEquipe(membre.id),
    ecran: propres[membre.id]?.ecran ?? `equipe-${membre.id}`,
  }))
}

export type ProprietesMenu = {
  locale: string
  ecran: string
  /** Le site regardé, pour que les liens n'en changent pas en chemin. */
  siteId?: string
  isAdmin?: boolean
}

/**
 * Le menu lui-même, sans le contenant.
 *
 * Séparé du bouton d'ouverture parce que les deux surfaces n'en veulent pas la même chose :
 * la colonne de gauche l'affiche en permanence, le téléphone le fait apparaître. Une seule
 * fonction qui gère les deux finissait par afficher les deux à la fois sur grand écran — le
 * menu en colonne, et le même à nouveau dans l'en-tête.
 */
export function ContenuMenu({ locale, ecran, siteId = '', isAdmin = false }: ProprietesMenu) {
  const site = siteId === '' ? '' : `?siteId=${siteId}`

  const resultats: Entree[] = [
    {
      nom: 'Votre visibilité',
      quoi: 'Les deux notes et les priorités',
      href: `/${locale}/visibilite`,
      ecran: 'visibilite',
    },
    {
      nom: 'Dans les IA',
      quoi: 'Ce que répondent les assistants',
      href: `/${locale}/visibilite/assistants${site}`,
      ecran: 'assistants',
    },
    {
      nom: 'Recherches',
      quoi: 'Ce qu’on tape pour vous trouver',
      href: `/${locale}/visibilite/recherches${site}`,
      ecran: 'recherches',
    },
    {
      nom: 'Historique',
      quoi: 'Ce qui a changé depuis',
      href: `/${locale}/visibilite/historique${site}`,
      ecran: 'historique',
    },
  ]

  const reglages: Entree[] = [
    {
      nom: 'Automatisation',
      quoi: 'Ce qui se fait tout seul',
      href: `/${locale}/visibilite/automatisation${site}`,
      ecran: 'automatisation',
    },
    {
      nom: 'Connexions',
      quoi: 'Google, Meta, Shopify',
      href: `/${locale}/connexions`,
      ecran: 'connexions',
    },
    {
      nom: 'Abonnement',
      quoi: 'Votre offre et vos crédits',
      href: `/${locale}/abonnement`,
      ecran: 'abonnement',
    },
    ...(isAdmin
      ? [
          {
            nom: 'Administration',
            quoi: 'Le back-office',
            href: `/${locale}/administration`,
            ecran: 'administration',
          },
        ]
      : []),
  ]

  const teintes = Object.fromEntries(
    MEMBRES.map((membre) => [membre.id, membre.tint] as const),
  ) as Record<string, string>

  return (
    <nav aria-label="Navigation principale" className="px-3 pb-6">
      <Groupe
        titre="Votre équipe"
        entrees={destinations(locale, siteId)}
        courant={ecran}
        teintes={teintes}
      />
      <Groupe titre="Ce que ça donne" entrees={resultats} courant={ecran} />
      <Groupe titre="Réglages" entrees={reglages} courant={ecran} />
    </nav>
  )
}

/**
 * Le même menu, derrière un bouton, pour les écrans étroits.
 *
 * Deux colonnes sur un téléphone laisseraient au contenu une largeur où rien ne se lit — et
 * un menu qui occupe l'écran entier avant le contenu fait fermer l'onglet.
 */
export function MenuMobile(proprietes: ProprietesMenu) {
  const [ouvert, setOuvert] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert((avant) => !avant)}
        aria-expanded={ouvert}
        className="cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-sm lg:hidden"
      >
        {ouvert ? 'Fermer' : 'Menu'}
      </button>

      {!ouvert ? null : (
        <div className="absolute top-full right-0 left-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg lg:hidden">
          <ContenuMenu {...proprietes} />
        </div>
      )}
    </>
  )
}
