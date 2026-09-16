import type { ReactNode } from 'react'
import type { VisibilityAgent } from '@/server/agents/visibility'

/**
 * Les pièces visuelles de la page publique du nouveau positionnement.
 *
 * Elles vivent à part pour que la page ne soit que du contenu et son ordre — c'est la règle
 * qui valait déjà pour l'ancienne, et c'est elle qui a rendu ce remplacement tenable.
 */

/**
 * L'initiale affichée dans la pastille, faute de portrait.
 *
 * Calculée ici plutôt qu'importée du serveur : la règle d'architecture veut que les
 * composants ne prennent au serveur que des types. Elle a une raison — ce qui traverse cette
 * frontière finit dans le paquet envoyé au navigateur —, et une ligne recopiée coûte moins
 * cher qu'une exception dans la règle.
 */
function initiale(agent: VisibilityAgent): string {
  return agent.name.slice(0, 1).toUpperCase()
}

/** Les teintes des spécialistes, en jetons du design system. */
const TEINTES: Record<VisibilityAgent['tint'], { fond: string; anneau: string }> = {
  brand: { fond: 'var(--color-brand-soft)', anneau: 'var(--color-brand)' },
  accent: { fond: 'var(--color-accent-soft)', anneau: 'var(--color-accent)' },
  warm: { fond: '#fff1e8', anneau: 'var(--color-accent-warm)' },
  night: { fond: '#ece4f6', anneau: 'var(--color-night-soft)' },
}

/**
 * Le portrait d'un spécialiste.
 *
 * Faute d'image, une pastille à initiale. Fond tendre et lettre sombre plutôt que l'inverse :
 * la moitié chaude de la palette ne tient pas un texte blanc, et une pastille illisible
 * serait pire qu'une pastille sans caractère.
 */
export function AgentAvatar({ agent, size = 56 }: { agent: VisibilityAgent; size?: number }) {
  const teinte = TEINTES[agent.tint]
  if (agent.avatar !== undefined) {
    return (
      <img
        src={agent.avatar}
        alt=""
        width={size}
        height={size}
        className="rounded-[var(--radius-pill)] object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[var(--radius-pill)] font-semibold text-[var(--color-ink)]"
      style={{
        width: size,
        height: size,
        background: teinte.fond,
        boxShadow: `inset 0 0 0 2px ${teinte.anneau}`,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initiale(agent)}
    </span>
  )
}

/** La fiche d'un spécialiste : qui il est, ce dont il s'occupe, ce qu'on peut lui demander. */
export function AgentCard({
  agent,
  handlesLabel,
  askLabel,
  soonLabel,
}: {
  agent: VisibilityAgent
  handlesLabel: string
  askLabel: string
  soonLabel: string
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <div className="flex items-center gap-4">
        <AgentAvatar agent={agent} />
        <div>
          <h3 className="m-0 text-lg font-semibold">{agent.name}</h3>
          <p className="m-0 text-sm text-[var(--color-ink-faint)]">{agent.role}</p>
        </div>
        {/*
          L'étiquette est affichée parce que c'est vrai. Décrire une équipe au présent avant
          qu'elle existe est la façon la plus sûre de décevoir quelqu'un qui s'inscrit.
        */}
        <span className="ml-auto self-start rounded-[var(--radius-pill)] border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-ink-faint)]">
          {soonLabel}
        </span>
      </div>

      <p className="mt-4 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        {agent.summary}
      </p>

      <p className="mt-5 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
        {handlesLabel}
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {agent.handles.map((quoi) => (
          <li
            key={quoi}
            className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-3 py-1 text-xs text-[var(--color-ink-soft)]"
          >
            {quoi}
          </li>
        ))}
      </ul>

      <p className="mt-5 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
        {askLabel}
      </p>
      <p className="m-0 text-sm text-[var(--color-ink-soft)] italic">« {agent.starters[0]} »</p>
    </div>
  )
}

/**
 * Un score montré en exemple.
 *
 * L'étiquette « exemple » n'est pas négociable et vit dans le même bloc que le chiffre : un
 * nombre sur cent affiché sur une page de vente se lit comme une promesse, et celui-ci n'en
 * est pas une.
 */
export function ScoreDial({
  label,
  value,
  delta,
}: {
  label: string
  value: number
  delta: number
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/15 bg-white/10 px-5 py-4">
      <p className="m-0 text-xs tracking-wide text-white/70 uppercase">{label}</p>
      <p className="m-0 mt-1 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-tight text-white">{value}</span>
        <span className="text-sm text-white/60">/ 100</span>
        <span className="ml-1 text-sm font-medium text-[var(--color-accent-sun)]">+{delta}</span>
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-white/15">
        <div
          className="h-full rounded-[var(--radius-pill)]"
          style={{ width: `${value}%`, background: 'var(--gradient-brand)' }}
        />
      </div>
    </div>
  )
}

/** Une famille de contrôles, listée telle qu'elle est mesurée. */
export function CheckFamily({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-1.5 p-0">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-2.5 py-1 text-xs text-[var(--color-ink-soft)]"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Un engagement de retenue, avec son titre et sa raison. */
export function HonestCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <h3 className="m-0 text-base font-semibold">{title}</h3>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">{children}</p>
    </div>
  )
}

/**
 * Une priorité, montrée plutôt que décrite.
 *
 * C'est le cœur de ce que le produit rend, et une page qui se contente d'en parler perd son
 * meilleur argument. Ce bloc reprend la forme exacte de ce que le créateur verra : un rang,
 * un constat chiffré, la raison en une phrase, et le bouton qui la corrige.
 *
 * Le bouton n'est pas cliquable ici, et il n'a pas l'air de l'être : un appel à l'action qui
 * ne fait rien sur une page de vente est une petite trahison, et on la remarque.
 */
export function PriorityExample({
  badge,
  headline,
  why,
  cta,
}: {
  badge: string
  headline: string
  why: string
  cta: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-[var(--radius-pill)] bg-[var(--color-critical-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-critical)]">
          {badge}
        </span>
        <h3 className="m-0 text-lg font-semibold">{headline}</h3>
      </div>
      <p className="mt-3 mb-0 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-soft)]">
        {why}
      </p>
      <span
        aria-hidden="true"
        className="mt-5 inline-block rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-2 text-sm font-medium text-[var(--color-ink-soft)]"
      >
        {cta}
      </span>
    </div>
  )
}
