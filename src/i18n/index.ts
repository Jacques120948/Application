import { DEFAULT_LOCALE, type Locale } from './config'
import { fr, type MessageKey } from './messages/fr'
import { en } from './messages/en'
import { de } from './messages/de'
import { it } from './messages/it'
import { es } from './messages/es'

const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = { fr, en, de, it, es }

export type Translator = (key: MessageKey, values?: Record<string, string | number>) => string

/**
 * Construit le traducteur d'une langue.
 * Une clé absente retombe sur le français plutôt que d'afficher la clé brute.
 */
export function getTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE]
  return (key, values) => {
    const template = catalog[key] ?? fr[key]
    if (!values) return template
    return Object.entries(values).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
      template,
    )
  }
}

export type { MessageKey }
export * from './config'
