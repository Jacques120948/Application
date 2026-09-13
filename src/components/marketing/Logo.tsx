/**
 * Marque Evoliia.
 *
 * Le dessin reprend l'icône : une feuille claire, surmontée d'une étincelle, posée sur un
 * carré qui traverse tout le spectre de la marque, du jaune au violet en passant par le
 * rose. C'est l'inverse de la version précédente, où la feuille était colorée sur un fond
 * sombre : la couleur est passée au fond, où elle a la place de respirer.
 *
 * Il reste vectoriel pour être net à toutes les tailles, et ses arrêts de dégradé sont
 * ceux du design system.
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
        <linearGradient id={`${id}-bg`} x1="2" y1="2" x2="62" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fddd30" />
          <stop offset="16%" stopColor="#fc8f38" />
          <stop offset="34%" stopColor="#f81878" />
          <stop offset="54%" stopColor="#e8039a" />
          <stop offset="76%" stopColor="#a90ff0" />
          <stop offset="100%" stopColor="#7a0cf5" />
        </linearGradient>
        {/* Le bleu de l'icône ne traverse pas le carré : il couve sous la feuille. */}
        <radialGradient id={`${id}-glow`} cx="33" cy="47" r="19" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4217fc" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#4217fc" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`${id}-leaf`}
          x1="20"
          y1="52"
          x2="48"
          y2="12"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#ffe8fb" />
          <stop offset="100%" stopColor="#fff4cd" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id}-bg)`} />
      <rect width="64" height="64" rx="15" fill={`url(#${id}-glow)`} />
      <path d="M22 43C22 26 31 14 47 11c-1 18-9 29-25 32z" fill={`url(#${id}-leaf)`} />
      <path d="M22 54c4-10 13-15 25-15-3 11-12 17-25 15z" fill={`url(#${id}-leaf)`} opacity="0.86" />
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
