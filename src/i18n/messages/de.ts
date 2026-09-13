import type { MessageKey } from './fr'

/**
 * Catalogue allemand, pas encore traduit.
 *
 * Il est volontairement vide plutôt qu'ébauché. Une poignée de clés traduites au milieu de
 * trois cents ne donne pas une page allemande : elle donne une page française parsemée de
 * mots allemands, ce qui se lit plus mal que la page française entière. Tant que la
 * traduction n'est pas complète, la langue retombe donc entièrement sur le français, et
 * `LOCALE_COMPLETENESS` le déclare.
 *
 * Pour ouvrir cette langue : remplir ce catalogue, puis la passer à `complete` dans
 * i18n/config.ts. Un test vérifie qu'aucune langue déclarée complète ne laisse de trou.
 */
export const de: Partial<Record<MessageKey, string>> = {}
