import type { MessageKey } from './fr'

/**
 * Traduction partielle. Les clés absentes retombent sur le français, et le sélecteur de
 * langue le signale à l'utilisateur (voir LOCALE_COMPLETENESS).
 */
export const it: Partial<Record<MessageKey, string>> = {
  'home.heroTitle': "La tua idea diventa un'app.",
  'nav.dashboard': 'Le mie app',
  'dashboard.title': 'Le mie app',
  'dashboard.create': "Crea un'app",
  'create.question': 'Cosa vuoi creare?',
}
