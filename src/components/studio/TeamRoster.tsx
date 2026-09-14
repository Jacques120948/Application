/**
 * Les trois spécialistes en rangée, avec leur état pour la personne connectée.
 *
 * Sert au tableau de bord et à l'entrée « Équipe marketing » de la navigation : un
 * spécialiste ouvert dit « Disponible », un spécialiste fermé dit avec quelle offre il
 * s'ouvrirait — lu dans la couche de droits, jamais dans le nom d'une offre — et reste
 * visible en demi-teinte plutôt que caché.
 *
 * Aucune valeur du serveur n'est importée : tout arrive par `props`.
 */
export type RosterMember = {
  id: string
  name: string
  role: string
  avatar: string
  open: boolean
  availableWith: string | null
}

export function TeamRoster({ members }: { members: readonly RosterMember[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {members.map((member) => (
        <div
          key={member.id}
          className="flex gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-4"
        >
          <img
            src={member.avatar}
            alt=""
            width={48}
            height={48}
            className={`h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-[var(--color-surface)] ${member.open ? '' : 'opacity-60 grayscale'}`}
          />
          <div className="min-w-0">
            <p className="m-0 font-semibold leading-tight">{member.name}</p>
            <p className="m-0 text-xs text-[var(--color-ink-soft)]">{member.role}</p>
            <p className="m-0 mt-1 text-xs">
              {member.open ? (
                <span className="text-[var(--color-positive)]">Disponible</span>
              ) : member.availableWith === null ? (
                <span className="text-[var(--color-ink-faint)]">Non inclus dans votre offre</span>
              ) : (
                <span className="text-[var(--color-ink-faint)]">Avec l’offre {member.availableWith}</span>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
