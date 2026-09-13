import type { ReactNode } from 'react'
import { BrowserFrame, PhoneFrame } from './DeviceFrame'

/**
 * La vitrine des modules, sur fond de nuit.
 *
 * Le reste de la page est clair : cette section est l'endroit où l'on montre tout ce que
 * la plateforme met entre les mains d'une personne, et elle change de registre pour le
 * dire. Quatre modules phares en grand, avec de vraies captures de l'application ; puis la
 * grille complète, une tuile par module, pour que rien ne reste caché.
 *
 * Les effets restent dans les limites du raisonnable : un soulèvement au survol, une
 * apparition au défilement (`.reveal`, déjà coupée par `prefers-reduced-motion`), des
 * halos de couleur statiques. Rien qui bouge tout seul.
 */

export type IconName =
  | 'target'
  | 'bulb'
  | 'search'
  | 'document'
  | 'wand'
  | 'palette'
  | 'users'
  | 'coins'
  | 'shield'
  | 'rocket'
  | 'download'
  | 'plug'
  | 'lifebuoy'
  | 'chart'
  | 'radar'
  | 'chat'
  | 'megaphone'
  | 'team'

const PATHS: Record<IconName, ReactNode> = {
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.8.6 1.5 1.6 1.5 2.6V17h4v-.5c0-1 .7-2 1.5-2.6A6 6 0 0 0 12 3z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  document: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </>
  ),
  wand: (
    <>
      <path d="m4 20 11-11M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3c0-4.4-4-8.2-9-8.2z" />
      <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0M16 4a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  rocket: (
    <>
      <path d="M14 4c3 0 6 3 6 6-2 2-5 5-7 6l-3-3c1-2 4-5 4-9z" />
      <path d="M10 13 6 15l1 2 2 1 2-4M15 9h.01" />
      <path d="M8 18c-1 1-2 3-2 3s2-1 3-2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" />
    </>
  ),
  lifebuoy: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 18 6" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v10H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  megaphone: (
    <>
      <path d="M4 10v4h3l7 4V6l-7 4zM17 9a4 4 0 0 1 0 6M7 14v5h3" />
    </>
  ),
  team: (
    <>
      <circle cx="12" cy="6" r="3" />
      <circle cx="5" cy="10" r="2.5" />
      <circle cx="19" cy="10" r="2.5" />
      <path d="M7 20a5 5 0 0 1 10 0M1.5 18a3.5 3.5 0 0 1 5-3.2M22.5 18a3.5 3.5 0 0 0-5-3.2" />
    </>
  ),
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? 'h-6 w-6'}
    >
      {PATHS[name]}
    </svg>
  )
}

/** Un badge « Compris dans … », posé sur fond sombre. */
function PlanChip({ label }: { label: string | null }) {
  if (label === null) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
      {label}
    </span>
  )
}

export type Showcase = {
  icon: IconName
  eyebrow: string
  title: string
  body: string
  bullets: string[]
  included: string | null
  /** Une capture d'écran de bureau, une de téléphone, ou les deux. */
  desktop?: { src: string; alt: string; caption?: string }
  phone?: { src: string; alt: string }
  href?: { label: string; to: string }
}

/**
 * Les modules phares, un par rangée, image et texte en alternance.
 *
 * Le halo derrière chaque capture n'est pas décoratif : sur un fond aussi sombre, une
 * capture claire posée à plat paraît collée. Le halo la détache et la fait flotter.
 */
export function ModuleShowcase({ items }: { items: Showcase[] }) {
  return (
    <div className="grid gap-16 lg:gap-24">
      {items.map((item, index) => {
        const flip = index % 2 === 1
        return (
          <article
            key={item.title}
            className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
          >
            <div className={`reveal ${flip ? 'lg:order-2' : ''}`}>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/80">
                <Icon name={item.icon} className="h-4 w-4 text-[var(--color-accent)]" />
                {item.eyebrow}
              </div>
              <h3 className="mt-4 text-balance text-2xl font-semibold leading-tight text-white sm:text-3xl">
                {item.title}
              </h3>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-white/75">{item.body}</p>
              <ul className="m-0 mt-5 grid list-none gap-2.5 p-0">
                {item.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2.5 text-sm text-white/90">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full [background-image:var(--gradient-cta)]"
                    />
                    {bullet}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <PlanChip label={item.included} />
                {item.href !== undefined ? (
                  <a
                    href={item.href.to}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-white no-underline hover:text-[var(--color-accent)]"
                  >
                    {item.href.label}
                    <span aria-hidden="true">→</span>
                  </a>
                ) : null}
              </div>
            </div>

            <div className={`reveal relative ${flip ? 'lg:order-1' : ''}`}>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-6 rounded-[2rem] opacity-70 blur-3xl"
                style={{
                  background:
                    'radial-gradient(60% 60% at 30% 30%, rgba(248,24,120,0.45), transparent 70%), radial-gradient(60% 60% at 75% 70%, rgba(151,5,244,0.55), transparent 70%)',
                }}
              />
              {item.desktop !== undefined && item.phone !== undefined ? (
                <div className="relative grid grid-cols-[1fr_auto] items-end gap-4">
                  <BrowserFrame src={item.desktop.src} alt={item.desktop.alt} caption={item.desktop.caption} />
                  <PhoneFrame src={item.phone.src} alt={item.phone.alt} className="w-28 sm:w-36" />
                </div>
              ) : item.desktop !== undefined ? (
                <div className="relative">
                  <BrowserFrame src={item.desktop.src} alt={item.desktop.alt} caption={item.desktop.caption} />
                </div>
              ) : item.phone !== undefined ? (
                <div className="relative flex justify-center">
                  <PhoneFrame src={item.phone.src} alt={item.phone.alt} className="w-56 sm:w-64" />
                </div>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export type Tile = { icon: IconName; title: string; body: string; included: string | null }

/** La grille complète : une tuile par module, rien de caché. */
export function ModuleGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <li
          key={tile.title}
          className="reveal group relative flex flex-col gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm transition duration-200 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.1] hover:shadow-[0_30px_60px_-30px_rgba(248,24,120,0.55)]"
        >
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-white [background-image:var(--gradient-cta)] shadow-[0_10px_24px_-12px_rgba(248,24,120,0.8)]">
            <Icon name={tile.icon} className="h-5 w-5" />
          </span>
          <h4 className="m-0 text-base font-semibold text-white">{tile.title}</h4>
          <p className="m-0 text-sm leading-relaxed text-white/70">{tile.body}</p>
          {tile.included !== null ? (
            <span className="mt-auto pt-1 text-xs font-medium text-white/60">{tile.included}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
