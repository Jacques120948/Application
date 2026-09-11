import type { MessageKey } from './fr'

/**
 * Traduction partielle. Les clés absentes retombent sur le français, et le sélecteur de
 * langue le signale à l'utilisateur (voir LOCALE_COMPLETENESS).
 */
export const de: Partial<Record<MessageKey, string>> = {
  'home.heroTitle': 'Ihre Idee wird zur App.',
  'nav.dashboard': 'Meine Apps',
  'dashboard.title': 'Meine Apps',
  'dashboard.create': 'App erstellen',
  'create.question': 'Was möchten Sie erstellen?',
}
