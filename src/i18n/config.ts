/**
 * Internationalisation.
 *
 * La langue est séparée du code : aucune chaîne visible n'est écrite en dur dans un
 * composant. Les catalogues sont des objets plats (clé pointée -> texte), ce qui permet
 * de les extraire, traduire et compléter sans toucher au code (exigence 26).
 */

export const SUPPORTED_LOCALES = ['fr', 'en', 'de', 'it', 'es'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'fr'

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  it: 'Italiano',
  es: 'Español',
}

/**
 * État de traduction, affiché honnêtement dans le sélecteur de langue.
 * `partial` signifie que les clés manquantes retombent sur le français.
 */
export const LOCALE_COMPLETENESS: Record<Locale, 'complete' | 'partial'> = {
  fr: 'complete',
  en: 'complete',
  de: 'partial',
  it: 'partial',
  es: 'partial',
}

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export function resolveLocale(value: string | undefined | null): Locale {
  return value !== null && value !== undefined && isLocale(value) ? value : DEFAULT_LOCALE
}

/**
 * Langue réellement affichée pour une adresse donnée.
 *
 * `/de` existe encore, mais son catalogue est vide : la page qui s'y affiche est
 * française. Déclarer « de » à cet endroit tromperait les lecteurs d'écran, qui
 * prononceraient du français à l'allemande. Tant que la traduction n'est pas faite, c'est
 * le français qui est annoncé, parce que c'est le français qui est lu.
 */
export function renderedLocale(locale: Locale): Locale {
  return LOCALE_COMPLETENESS[locale] === 'complete' ? locale : DEFAULT_LOCALE
}

/** Langues réellement traduites de bout en bout. Les seules vers lesquelles on oriente. */
export function completeLocales(): Locale[] {
  return SUPPORTED_LOCALES.filter((locale) => LOCALE_COMPLETENESS[locale] === 'complete')
}

/**
 * Négociation depuis l'en-tête Accept-Language, sans dépendance externe.
 *
 * Une langue seulement prévue n'est jamais choisie ici. Envoyer un visiteur allemand vers
 * `/de` lui donnerait la page française avec une adresse allemande ; l'envoyer vers la
 * langue complète la plus proche de ce qu'il demande lui donne une page entière. Il peut
 * toujours atteindre `/de` en le tapant, et il y trouvera le français, cohérent de bout en
 * bout.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  const offered = completeLocales()
  if (!acceptLanguage) return DEFAULT_LOCALE
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) : 1 }
    })
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const base = tag.split('-')[0] ?? ''
    if (isLocale(base) && offered.includes(base)) return base
  }
  return DEFAULT_LOCALE
}
