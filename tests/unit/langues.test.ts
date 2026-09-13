import { describe, expect, it } from 'vitest'
import { fr } from '@/i18n/messages/fr'
import { en } from '@/i18n/messages/en'
import { de } from '@/i18n/messages/de'
import { it as italien } from '@/i18n/messages/it'
import { es } from '@/i18n/messages/es'
import {
  completeLocales,
  DEFAULT_LOCALE,
  LOCALE_COMPLETENESS,
  negotiateLocale,
  renderedLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from '@/i18n/config'
import { getTranslator } from '@/i18n'

/**
 * Une langue est complète ou vide, jamais à moitié.
 *
 * Cette règle vient d'un vrai défaut : trois catalogues comptaient six clés traduites sur
 * trois cents. La page ne devenait pas allemande pour autant — elle devenait française
 * avec six mots allemands dedans, ce qui se lit plus mal que la page française entière.
 */

const CATALOGUES: Record<Locale, Partial<Record<string, string>>> = {
  fr,
  en,
  de,
  it: italien,
  es,
}

const cles = Object.keys(fr)

describe('langues', () => {
  it('ne déclare complète qu’une langue sans aucun trou', () => {
    const trous = SUPPORTED_LOCALES.filter(
      (locale) => LOCALE_COMPLETENESS[locale] === 'complete',
    ).flatMap((locale) => {
      const catalogue = CATALOGUES[locale]
      const manquantes = cles.filter((cle) => catalogue[cle] === undefined)
      return manquantes.length === 0 ? [] : [`${locale} : ${manquantes.length} clés manquantes`]
    })
    expect(trous).toEqual([])
  })

  it('laisse vide toute langue non traduite, plutôt qu’à moitié', () => {
    const melanges = SUPPORTED_LOCALES.filter(
      (locale) => LOCALE_COMPLETENESS[locale] === 'partial',
    )
      .filter((locale) => Object.keys(CATALOGUES[locale]).length > 0)
      .map((locale) => `${locale} est partielle mais non vide`)
    expect(melanges).toEqual([])
  })

  it('n’oriente un visiteur que vers une langue complète', () => {
    const complètes = completeLocales()
    expect(complètes).toContain(DEFAULT_LOCALE)
    // Un navigateur allemand reçoit une page entière, pas une adresse allemande sur du
    // français.
    expect(complètes).toContain(negotiateLocale('de-DE,de;q=0.9'))
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en')
    expect(negotiateLocale('fr-CH,fr;q=0.9')).toBe('fr')
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE)
  })

  it('retombe sur le français plutôt que d’afficher une clé brute', () => {
    expect(getTranslator('de')('landing.heroTitle')).toBe(fr['landing.heroTitle'])
  })

  it('remplace les valeurs dans toutes les langues complètes', () => {
    for (const locale of completeLocales()) {
      const texte = getTranslator(locale)('landing.pricingCredits', { count: 100 })
      expect(texte).toContain('100')
      expect(texte).not.toContain('{count}')
    }
  })
})

describe('langue annoncée', () => {
  it('annonce la langue réellement affichée, pas celle de l’adresse', () => {
    // Une adresse en langue non traduite affiche du français : c'est le français qu'elle
    // doit déclarer, sans quoi un lecteur d'écran prononcerait du français à l'allemande.
    expect(renderedLocale('fr')).toBe('fr')
    expect(renderedLocale('en')).toBe('en')
    expect(renderedLocale('de')).toBe('fr')
    expect(renderedLocale('it')).toBe('fr')
    expect(renderedLocale('es')).toBe('fr')
  })
})
