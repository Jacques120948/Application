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
/** Trois tailles, et pas une de plus : la pastille, la carte, le portrait. */
export const AVATAR_SIZES = { sm: 32, md: 56, lg: 88 } as const

export type AvatarSize = keyof typeof AVATAR_SIZES

export function AgentAvatar({
  agent,
  size = 'md',
  halo = false,
}: {
  agent: VisibilityAgent
  size?: AvatarSize
  halo?: boolean
}) {
  const teinte = TEINTES[agent.tint]
  const cote = AVATAR_SIZES[size]
  const cercle = {
    width: cote,
    height: cote,
    // Le halo est posé à l'extérieur du cercle : il entoure sans rogner le portrait.
    boxShadow: halo
      ? `0 0 0 3px var(--color-surface), 0 0 0 5px ${teinte.anneau}33`
      : `inset 0 0 0 2px ${teinte.anneau}`,
  }

  if (agent.avatar !== undefined) {
    return (
      <img
        src={agent.avatar}
        alt=""
        width={cote}
        height={cote}
        loading="lazy"
        decoding="async"
        /*
         * `object-cover` sur un carré : un portrait livré dans un autre format est recadré
         * au centre plutôt que déformé. C'est ce qui permet de déposer des images sans
         * retoucher une ligne de code ici.
         */
        className="shrink-0 rounded-[var(--radius-pill)] object-cover"
        style={{ ...cercle, background: teinte.fond }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[var(--radius-pill)] font-semibold text-[var(--color-ink)]"
      style={{ ...cercle, background: teinte.fond, fontSize: Math.round(cote * 0.42) }}
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
  atWorkLabel,
}: {
  agent: VisibilityAgent
  handlesLabel: string
  askLabel: string
  soonLabel: string
  atWorkLabel: string
}) {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <div className="flex items-center gap-4">
        <AgentAvatar agent={agent} size="lg" halo />
        <div>
          <h3 className="m-0 text-lg font-semibold">{agent.name}</h3>
          <p className="m-0 text-sm text-[var(--color-ink-faint)]">{agent.role}</p>
        </div>
        {/*
          L'étiquette dit ce qui est vrai de ce spécialiste-là, et pas de l'équipe en bloc.
          Décrire une équipe au présent avant qu'elle existe est la façon la plus sûre de
          décevoir quelqu'un qui s'inscrit ; se taire sur ce qui marche déjà est la façon la
          plus sûre de ne pas le convaincre.
        */}
        <span
          className="ml-auto self-start rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs"
          style={
            agent.atWork === null
              ? { borderColor: 'var(--color-line)', color: 'var(--color-ink-faint)' }
              : {
                  borderColor: 'var(--color-brand)',
                  color: 'var(--color-brand-strong)',
                  background: 'var(--color-brand-soft)',
                }
          }
        >
          {agent.atWork === null ? soonLabel : atWorkLabel}
        </span>
      </div>

      <p className="mt-4 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        {agent.summary}
      </p>
      {agent.atWork === null ? null : (
        <p className="mt-3 mb-0 text-sm leading-relaxed font-medium text-[var(--color-brand-strong)]">
          {agent.atWork}
        </p>
      )}

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

/**
 * Le tableau de bord, montré tel qu'il sera.
 *
 * C'est la pièce qui fait comprendre le produit en trois secondes, là où trois paragraphes
 * n'y arrivent pas. Elle est dessinée et non capturée : une capture d'écran d'un produit en
 * construction serait périmée dans la semaine, et une capture retouchée serait un mensonge.
 *
 * Les chiffres portent la mention « exemple » dans le même bloc, parce qu'une note sur cent
 * posée sur une page de vente se lit comme un engagement.
 */
export function DashboardMockup({
  labels,
}: {
  labels: {
    title: string
    seo: string
    geo: string
    pages: string
    priorities: string
    sample: string
    team: string
  }
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/15 bg-white/[0.07] p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4">
        <p className="m-0 text-sm font-medium text-white">{labels.title}</p>
        <span className="rounded-[var(--radius-pill)] border border-white/20 px-2.5 py-0.5 text-[11px] text-white/60">
          {labels.sample}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ScoreDial label={labels.seo} value={74} delta={6} />
        <ScoreDial label={labels.geo} value={61} delta={11} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3">
          <p className="m-0 text-2xl font-semibold text-white">36</p>
          <p className="m-0 text-xs text-white/60">{labels.pages}</p>
        </div>
        <div className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3">
          <p className="m-0 text-2xl font-semibold text-white">5</p>
          <p className="m-0 text-xs text-white/60">{labels.priorities}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4">
        <span className="flex -space-x-2">
          {['L', 'N', 'G', 'M'].map((lettre) => (
            <span
              key={lettre}
              aria-hidden="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] border-2 border-[var(--color-night)] bg-white/90 text-xs font-semibold text-[var(--color-ink)]"
            >
              {lettre}
            </span>
          ))}
        </span>
        <p className="m-0 text-xs text-white/60">{labels.team}</p>
      </div>
    </div>
  )
}

/** Une inquiétude que le visiteur reconnaît, dite avec ses mots. */
export function PainCard({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <p className="m-0 text-base leading-relaxed text-[var(--color-ink)] italic">« {text} »</p>
    </div>
  )
}

/** Une étape numérotée du parcours. */
export function StepCard({
  index,
  title,
  body,
}: {
  index: number
  title: string
  body: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <span
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-pill)] text-sm font-semibold text-white"
        style={{ background: 'var(--gradient-cta)' }}
      >
        {index}
      </span>
      <h3 className="mt-4 mb-0 text-base font-semibold">{title}</h3>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">{body}</p>
    </div>
  )
}

/**
 * Le problème, puis la proposition, puis le geste.
 *
 * La forme compte autant que le texte : montrer côte à côte ce qu'on a et ce qu'on obtient
 * est ce qui distingue un outil qui diagnostique d'un outil qui aide. Le bouton « Copier »
 * est dessiné, pas actif — un bouton qui ne fait rien sur une page de vente se remarque.
 */
export function FixExample({
  problemLabel,
  problem,
  proposalLabel,
  proposal,
  copyLabel,
  agentLabel,
}: {
  problemLabel: string
  problem: string
  proposalLabel: string
  proposal: string
  copyLabel: string
  agentLabel: string
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-critical)] uppercase">
          {problemLabel}
        </p>
        <p className="mt-2 mb-0 text-base font-medium">{problem}</p>
      </div>

      <span
        aria-hidden="true"
        className="justify-self-center rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium text-white"
        style={{ background: 'var(--gradient-cta)' }}
      >
        {agentLabel}
      </span>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] p-6">
        <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-brand-strong)] uppercase">
          {proposalLabel}
        </p>
        <p className="mt-2 mb-0 text-base leading-relaxed">« {proposal} »</p>
        <span
          aria-hidden="true"
          className="mt-4 inline-block rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)]"
        >
          {copyLabel}
        </span>
      </div>
    </div>
  )
}

/** Un type d'entreprise à qui le produit s'adresse. */
export function AudienceChip({ label }: { label: string }) {
  return (
    <li className="rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-ink-soft)]">
      {label}
    </li>
  )
}
