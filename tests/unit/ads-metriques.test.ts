import { describe, expect, it } from 'vitest'
import {
  CUMUL_VIDE,
  cumuler,
  ecartEnPoints,
  enUnites,
  fenetre,
  indicateurs,
  jourDansFuseau,
  variation,
} from '@/server/ads/metriques'

/**
 * Les calculs publicitaires.
 *
 * Ce sont les seuls chiffres du produit qui décident d'une dépense réelle, et c'est
 * pourquoi ils ne sont pas confiés au modèle. Ce qui est protégé ici n'est pas
 * l'arithmétique — elle est triviale — mais les cas où le bon résultat est « je ne sais
 * pas ». Un tableau de bord qui répond zéro à une question qui n'a pas de réponse ment
 * avec l'air de mesurer.
 */

describe('les indicateurs d’une période', () => {
  it('calcule ce qui se calcule', () => {
    const cumul = {
      coutMicros: 192_470_000, // 192,47 dans la devise du compte
      impressions: 10_000,
      clics: 304,
      conversions: 9,
      valeurConversion: 1_119.7,
    }
    const vu = indicateurs(cumul)
    expect(vu.cout).toBe(192.47)
    // 1119,70 / 192,47 = 5,817… soit 582 %
    expect(vu.roas).toBe(582)
    expect(vu.cpa).toBe(21.39)
    expect(vu.ctr).toBe(3)
    expect(vu.cpc).toBe(0.63)
    expect(vu.tauxConversion).toBe(3)
  })

  it('rend « pas de réponse » plutôt que zéro quand il n’y a rien à diviser', () => {
    /*
     * La règle qui compte. Une campagne sans dépense n'a pas un ROAS de 0 % : elle n'en a
     * pas. Afficher zéro ferait croire à un échec là où il n'y a rien à juger, et enverrait
     * corriger une campagne qui n'a simplement pas encore tourné.
     */
    const vu = indicateurs(CUMUL_VIDE)
    expect(vu.roas).toBeNull()
    expect(vu.cpa).toBeNull()
    expect(vu.ctr).toBeNull()
    expect(vu.cpc).toBeNull()
    expect(vu.tauxConversion).toBeNull()
    // Ce qui se compte, en revanche, vaut bien zéro.
    expect(vu.cout).toBe(0)
    expect(vu.clics).toBe(0)
  })

  it('distingue une dépense sans conversion d’une absence de dépense', () => {
    const vu = indicateurs({ ...CUMUL_VIDE, coutMicros: 50_000_000, clics: 100, impressions: 900 })
    // Dépensé sans rien rapporter : le ROAS vaut zéro, et c'est un vrai zéro.
    expect(vu.roas).toBe(0)
    // Mais le coût par conversion n'existe pas : il n'y a pas eu de conversion.
    expect(vu.cpa).toBeNull()
  })
})

describe('les variations entre deux périodes', () => {
  it('rend l’écart relatif quand les deux côtés existent', () => {
    expect(variation(120, 100)).toBe(20)
    expect(variation(80, 100)).toBe(-20)
  })

  it('refuse de comparer à rien', () => {
    /*
     * « +100 % » sorti d'une division par zéro dit quelque chose de faux avec l'air de dire
     * quelque chose de bien. Mieux vaut ne rien afficher.
     */
    expect(variation(120, 0)).toBeNull()
    expect(variation(120, null)).toBeNull()
    expect(variation(null, 100)).toBeNull()
  })

  it('compte en points ce qui est déjà un pourcentage', () => {
    // Un ROAS qui passe de 231 % à 245 % gagne 14 points, pas 6 %.
    expect(ecartEnPoints(245, 231)).toBe(14)
    expect(ecartEnPoints(245, null)).toBeNull()
  })
})

describe('les journées, dans le fuseau du compte', () => {
  it('découpe la journée là où le compte est déclaré', () => {
    /*
     * Un serveur à Francfort qui découpe les journées d'un compte californien décale tout
     * d'un jour, et la variation qu'on en tire compare deux périodes qui ne sont pas celles
     * qu'on croit. Le 21 septembre à 01h00 UTC est encore le 20 à Los Angeles.
     */
    const instant = new Date('2026-09-21T01:00:00Z')
    expect(jourDansFuseau(instant, 'Europe/Zurich')).toBe('2026-09-21')
    expect(jourDansFuseau(instant, 'America/Los_Angeles')).toBe('2026-09-20')
  })

  it('retombe sur le temps universel quand le fuseau est inconnu', () => {
    const instant = new Date('2026-09-21T12:00:00Z')
    expect(jourDansFuseau(instant, 'Terre/Milieu')).toBe('2026-09-21')
    expect(jourDansFuseau(instant, '')).toBe('2026-09-21')
  })

  it('s’arrête hier, jamais aujourd’hui', () => {
    /*
     * La journée en cours est incomplète par définition. La mettre dans une moyenne fait
     * plonger tous les indicateurs chaque matin, et personne ne comprend pourquoi.
     */
    const bornes = fenetre(7, 'Europe/Zurich', new Date('2026-09-21T12:00:00Z'))
    expect(bornes.jusqua).toBe('2026-09-20')
    expect(bornes.depuis).toBe('2026-09-14')
  })
})

describe('le cumul', () => {
  it('additionne les journées sans rien perdre', () => {
    const total = cumuler([
      { coutMicros: 1_000_000, impressions: 10, clics: 2, conversions: 1, valeurConversion: 40 },
      { coutMicros: 2_500_000, impressions: 30, clics: 5, conversions: 0.5, valeurConversion: 20 },
    ])
    expect(enUnites(total.coutMicros)).toBe(3.5)
    expect(total.conversions).toBe(1.5)
    expect(total.impressions).toBe(40)
  })
})
