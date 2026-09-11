import type { MessageKey } from './fr'

/**
 * Traduction partielle. Les clés absentes retombent sur le français, et le sélecteur de
 * langue le signale à l'utilisateur (voir LOCALE_COMPLETENESS).
 */
export const es: Partial<Record<MessageKey, string>> = {
  'home.heroTitle': 'Tu idea se convierte en una aplicación.',
  'nav.dashboard': 'Mis aplicaciones',
  'dashboard.title': 'Mis aplicaciones',
  'dashboard.create': 'Crear una aplicación',
  'create.question': '¿Qué quieres crear?',
}
