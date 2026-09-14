import { Eyebrow } from '@/components/marketing/landing'

/**
 * L'équipe marketing sur la page publique.
 *
 * Trois portraits, trois métiers, et pour chacun ce qu'il lit et une question qu'on
 * pourrait lui poser. La page ne dit pas « une équipe est à votre disposition » : elle
 * montre qui, et sur quoi chacun s'appuie. Un visage se retient, un intitulé de fonction
 * s'oublie.
 *
 * Deux choses sont dites en toutes lettres, par honnêteté : ce sont des spécialistes IA,
 * et ils ne parlent que de données réelles du projet. Rien ici ne prétend être une
 * personne, et rien ne promet un résultat.
 *
 * Aucune chaîne visible n'est écrite ici, tout arrive par `props` ; le catalogue des
 * spécialistes est lu par la page, côté serveur, et transmis.
 */
export type TeamMember = {
  id: string
  name: string
  avatar: string
  role: string
  body: string
  /** Un exemple de question, affiché entre guillemets. */
  ask: string
  /** « Dès l'offre … », ou rien si aucune offre ne l'ouvre. */
  included: string | null
}

export function TeamShowcase({
  members,
  askLabel,
  aiLabel,
}: {
  members: readonly TeamMember[]
  askLabel: string
  aiLabel: string
}) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {members.map((member, index) => (
        <article
          key={member.id}
          className="reveal flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[0_20px_50px_-32px_rgba(151,5,244,0.45)]"
          style={{ transitionDelay: `${index * 90}ms` }}
        >
          <div className="flex items-center gap-4">
            <img
              src={member.avatar}
              alt=""
              width={80}
              height={80}
              loading="lazy"
              className="h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-[var(--color-brand-soft)]"
            />
            <div className="min-w-0">
              <Eyebrow>{aiLabel}</Eyebrow>
              <h3 className="m-0 mt-1 text-xl font-semibold leading-tight">{member.name}</h3>
              <p className="m-0 mt-0.5 text-sm font-medium text-[var(--color-brand-strong)]">{member.role}</p>
            </div>
          </div>
          <p className="mt-5 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">{member.body}</p>
          <div className="mt-5 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3">
            <p className="m-0 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">{askLabel}</p>
            <p className="m-0 mt-1 text-sm italic leading-snug">« {member.ask} »</p>
          </div>
          {member.included !== null ? (
            <p className="mt-auto mb-0 pt-5 text-xs font-medium text-[var(--color-ink-faint)]">{member.included}</p>
          ) : null}
        </article>
      ))}
    </div>
  )
}
