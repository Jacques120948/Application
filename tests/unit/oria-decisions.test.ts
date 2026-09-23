import { describe, expect, it } from 'vitest'
import { fenetresAutour, impactDeCorrection, impactPublicitaire } from '@/server/oria/decisions'

/**
 * La mesure de l'impact d'une décision.
 *
 * Trois façons de fausser une mesure avant/après, et chacune se teste ici : compter le jour
 * de la décision d'un côté, comparer des fenêtres de longueurs différentes, et conclure
 * avant que la fenêtre d'après soit écoulée.
 */

const J = 24 * 60 * 60 * 1000
const cumul = (cout: number, clics: number, conversions: number) => ({ cout, clics, conversions, valeur: 0 })

describe('les fenêtres autour d’une décision', () => {
  it('sautent le jour de la décision, et font la même longueur des deux côtés', () => {
    const quand = new Date('2026-09-10T15:30:00Z')
    const f = fenetresAutour(quand, 7)
    expect(f.avant.jusqua.toISOString()).toBe('2026-09-10T00:00:00.000Z')
    expect(f.apres.depuis.toISOString()).toBe('2026-09-11T00:00:00.000Z')
    expect(+f.avant.jusqua - +f.avant.depuis).toBe(7 * J)
    expect(+f.apres.jusqua - +f.apres.depuis).toBe(7 * J)
  })
})

describe('l’impact d’une décision publicitaire', () => {
  it('parle de conversions quand il y en a eu, de clics sinon', () => {
    expect(impactPublicitaire(cumul(100, 50, 0), cumul(80, 40, 0), 'CHF')[0]?.quoi).toBe('Clics')
    expect(impactPublicitaire(cumul(100, 50, 0), cumul(80, 40, 2), 'CHF')[0]?.quoi).toBe('Conversions')
  })

  it('montre toujours la dépense à côté, sans la juger', () => {
    /*
     * Une baisse de budget fait baisser les clics. Sans la dépense à côté, on lirait comme
     * un échec ce qui était le but de la décision.
     */
    const depense = impactPublicitaire(cumul(100, 50, 0), cumul(50, 25, 0), 'CHF').find(
      (mesure) => mesure.quoi === 'Dépense',
    )
    expect(depense?.sens).toBe('neutre')
    expect(depense?.unite).toBe('CHF')
  })

  it('ne calcule le coût par conversion que si les deux fenêtres en ont', () => {
    const quoi = (m: ReturnType<typeof impactPublicitaire>) => m.map((un) => un.quoi)
    expect(quoi(impactPublicitaire(cumul(100, 50, 0), cumul(80, 40, 2), 'CHF'))).not.toContain(
      'Coût par conversion',
    )
    expect(quoi(impactPublicitaire(cumul(100, 50, 4), cumul(80, 40, 2), 'CHF'))).toContain(
      'Coût par conversion',
    )
  })
})

describe('l’impact d’une correction', () => {
  const audit = (jour: string, cro: number | null) => ({
    finishedAt: new Date(jour),
    seoScore: 70,
    geoScore: 60,
    croScore: cro,
  })

  it('attend la prochaine analyse : c’est elle seule qui dit si la correction a pris', () => {
    const impact = impactDeCorrection(new Date('2026-09-10'), 'cro', [audit('2026-09-01', 40)])
    expect(impact.etat).toBe('en-attente')
  })

  it('compare la note de l’analyse d’avant à celle d’après', () => {
    const impact = impactDeCorrection(new Date('2026-09-10'), 'cro', [
      audit('2026-08-20', 30),
      audit('2026-09-01', 40),
      audit('2026-09-15', 52),
      audit('2026-09-20', 60),
    ])
    expect(impact.etat).toBe('mesure')
    if (impact.etat !== 'mesure') return
    // L'analyse juste avant (1er septembre) et la première juste après (15 septembre).
    expect(impact.mesures[0]?.avant).toBe(40)
    expect(impact.mesures[0]?.apres).toBe(52)
    expect(impact.mesures[0]?.sens).toBe('mieux')
  })

  it('ne compare pas une note à une note qui n’existait pas encore', () => {
    const impact = impactDeCorrection(new Date('2026-09-10'), 'cro', [
      audit('2026-09-01', null),
      audit('2026-09-15', 52),
    ])
    expect(impact.etat).toBe('indisponible')
  })
})
