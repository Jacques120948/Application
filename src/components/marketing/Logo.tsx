/**
 * Marque Evoliia.
 *
 * Le dessin reprend le logo : une feuille en dégradé violet → bleu → cyan, surmontée
 * d'une étincelle, posée sur un carré bleu nuit. Il est vectoriel pour rester net à
 * toutes les tailles, et n'utilise que les couleurs du design system.
 *
 * `id` distingue les dégradés lorsqu'une page affiche plusieurs fois la marque : deux
 * éléments SVG ne peuvent pas partager le même identifiant. Le nom affiché arrive par
 * `wordmark` plutôt que d'être écrit ici, pour qu'aucune chaîne visible ne vive dans un
 * composant (exigence 26).
 */
export function Logo({
  size = 32,
  id = 'evoliia-mark',
  wordmark,
  wordmarkClassName,
}: {
  size?: number
  id?: string
  wordmark?: string
  wordmarkClassName?: string
}) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={wordmark ?? 'Evoliia'}
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${id}-leaf`}
          x1="18"
          y1="54"
          x2="52"
          y2="10"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#a78bff" />
          <stop offset="50%" stopColor="#4c6bff" />
          <stop offset="100%" stopColor="#37c6f0" />
        </linearGradient>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1d1a5e" />
          <stop offset="100%" stopColor="#0b1033" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id}-bg)`} />
      <path d="M22 43C22 26 31 14 47 11c-1 18-9 29-25 32z" fill={`url(#${id}-leaf)`} />
      <path d="M22 54c4-10 13-15 25-15-3 11-12 17-25 15z" fill={`url(#${id}-leaf)`} opacity="0.72" />
      <path d="M49 8l1.7 4.6L55 14l-4.3 1.4L49 20l-1.7-4.6L43 14l4.3-1.4z" fill="#ffffff" />
    </svg>
  )

  if (wordmark === undefined) return mark

  return (
    <span className="inline-flex items-center gap-2.5">
      {mark}
      <span className={`text-lg font-semibold tracking-tight ${wordmarkClassName ?? ''}`}>
        {wordmark}
      </span>
    </span>
  )
}
