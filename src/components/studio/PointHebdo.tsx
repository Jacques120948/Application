/**
 * Le point de Léa, tel qu'on le lit.
 *
 * Il ouvre le tableau de bord parce que c'est le seul endroit du produit qui répond à « par
 * quoi je commence ». Tout le reste répond à « où en suis-je », ce qui est une autre
 * question et une question qu'on se pose moins souvent.
 *
 * Chaque action porte le fait mesuré qui la justifie. C'est la partie qui compte : sans
 * lui, c'est un conseil de magazine ; avec lui, la personne peut être en désaccord — ce qui
 * est le signe d'un conseil honnête.
 */

export type ActionVue = { quoi: string; pourquoi: string; qui: string }

export type PointVu = {
  etat: string
  actions: ActionVue[]
  createdAt: string
}

const QUI: Record<string, string> = {
  audit: 'Léa',
  seo: 'Néo',
  geo: 'Gia',
  content: 'Milo',
}

function quand(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

export function PointHebdo({
  point,
  locale,
  href,
}: {
  point: PointVu | null
  locale: string
  /** Où aller pour l'allumer, quand il n'a jamais tourné. */
  href: string
}) {
  if (point === null) {
    return (
      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <img
            src="/equipe/lea.webp"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
          <p className="m-0 flex-1 text-sm leading-relaxed">
            <strong>Léa</strong> peut faire le point chaque semaine : ce qui a bougé, et par
            quoi continuer. Elle est la seule à voir l’ensemble — l’analyse, les pannes,
            l’indexation, vos chiffres de recherche, ce qui a été publié, votre visibilité
            dans les assistants.
          </p>
        </div>
        <a href={href} className="mt-3 inline-block text-sm text-[var(--color-ink-soft)] underline">
          Allumer le point hebdomadaire
        </a>
      </section>
    )
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <img
          src="/equipe/lea.webp"
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">Le point de Léa</p>
          <p className="m-0 text-xs text-[var(--color-ink-faint)]">
            {quand(point.createdAt, locale)}
          </p>
        </div>
      </div>

      <p className="mt-4 mb-0 text-sm leading-relaxed whitespace-pre-line">{point.etat}</p>

      {point.actions.length === 0 ? null : (
        <div className="mt-5">
          <p className="m-0 mb-2 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
            Par quoi continuer
          </p>
          <ol className="m-0 grid list-none gap-2 p-0">
            {point.actions.map((action, rang) => (
              <li
                key={action.quoi}
                className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3"
              >
                <p className="m-0 text-sm font-medium">
                  {rang + 1}. {action.quoi}
                </p>
                <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                  {action.pourquoi}
                </p>
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">
                  {QUI[action.qui] ?? action.qui}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
