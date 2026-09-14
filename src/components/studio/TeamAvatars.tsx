/**
 * Les portraits de l'équipe marketing, en rangée serrée.
 *
 * Sert partout où l'on renvoie vers l'équipe sans l'afficher en entier : un bouton qui dit
 * « Voir mon équipe marketing » à côté de trois visages se comprend avant d'être lu. Les
 * portraits se chevauchent légèrement, comme les participants d'une conversation dans une
 * messagerie : c'est le code que tout le monde connaît.
 *
 * Aucune valeur du serveur n'est importée : les personnes arrivent par `props`, lues dans
 * le catalogue par la page qui les montre.
 */
export type TeamAvatar = { id: string; name: string; avatar: string; role?: string }

export function TeamAvatars({
  people,
  size = 'medium',
}: {
  people: readonly TeamAvatar[]
  size?: 'small' | 'medium'
}) {
  const dimension = size === 'small' ? 'h-8 w-8' : 'h-10 w-10'
  const names = people.map((person) => (person.role ? `${person.name} (${person.role})` : person.name)).join(', ')
  return (
    <span className="inline-flex shrink-0 items-center -space-x-2" role="img" aria-label={names} title={names}>
      {people.map((person) => (
        <img
          key={person.id}
          src={person.avatar}
          alt=""
          width={40}
          height={40}
          className={`${dimension} rounded-full object-cover ring-2 ring-[var(--color-surface)]`}
        />
      ))}
    </span>
  )
}
