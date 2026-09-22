import { membre } from '@/lib/equipe'

/**
 * Ce que MIRA a trouvé d'urgent, dit là où la personne regarde.
 *
 * MIRA tourne la nuit et ouvre ses constats sur son propre écran. Quelqu'un qui n'y va pas
 * ne sait rien — et il n'y va pas, parce que rien ne l'y appelle. Un budget qui part sans
 * vente se découvrait donc une semaine plus tard, sur un relevé bancaire.
 *
 * Deux décisions tiennent cette bande.
 *
 * **Elle ne paraît que pour l'urgent.** MIRA ouvre régulièrement des constats qui méritent
 * d'être lus — une créative qui s'use, un CPM qui monte — sans appeler le moindre geste
 * dans la journée. Les faire remonter ici installerait une alerte permanente, et une alerte
 * permanente n'alerte plus de rien : on apprend à ne plus la lire, y compris le jour où
 * elle a raison. Ce qui reste est ce qui coûte pendant qu'on ne regarde pas.
 *
 * **Elle nomme, elle ne résume pas.** « 2 choses à regarder » ferait cliquer par acquit de
 * conscience ; « Un ensemble dépense sans convertir » fait cliquer parce qu'on a compris.
 * Le nombre total reste dit quand il dépasse ce qui est nommé, pour qu'on sache qu'il en
 * manque.
 */

export type AlerteVue = { titre: string; cible: string }

export function AlerteMeta({
  combien,
  premiers,
  href,
}: {
  combien: number
  premiers: readonly AlerteVue[]
  href: string
}) {
  const mira = membre('meta')
  /*
   * L'absence de MIRA au catalogue ne fait pas d'écran à moitié rempli : on se tait. Elle
   * ne devrait jamais manquer, et c'est justement pourquoi on ne bâtit rien de conditionnel
   * autour d'elle — le jour où l'équipe changera, cette bande disparaîtra proprement.
   */
  if (combien <= 0 || premiers.length === 0 || mira === undefined) return null
  const reste = combien - premiers.length

  return (
    <a
      href={href}
      className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-caution,#b54708)]/30 bg-[var(--color-caution-soft,#fffaeb)] p-4 no-underline"
    >
      {/*
        Le visage de MIRA, comme dans le menu. Une alerte publicitaire au milieu d'un écran
        de visibilité a besoin de dire de qui elle vient : sans cela on la lit comme un
        défaut du site, et on cherche au mauvais endroit.
      */}
      <img
        src={mira.avatar}
        alt=""
        width={32}
        height={32}
        className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-cover"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--color-ink)]">
          {mira.name} a repéré {combien === 1 ? 'quelque chose d’urgent' : `${combien} choses urgentes`}{' '}
          sur vos publicités
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-[var(--color-ink-soft)]">
          {premiers.map((une) => (
            <span key={`${une.titre}-${une.cible}`} className="block">
              · {une.titre}
              {une.cible === '' ? '' : ` — ${une.cible}`}
            </span>
          ))}
          {reste <= 0 ? null : (
            <span className="block">
              · et {reste} autre{reste > 1 ? 's' : ''}
            </span>
          )}
        </span>
        <span className="mt-1.5 block text-xs font-medium text-[var(--color-brand-strong)]">
          Voir ce que {mira.name} propose →
        </span>
      </span>
    </a>
  )
}
