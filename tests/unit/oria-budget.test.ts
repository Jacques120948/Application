import { describe, expect, it } from 'vitest'
import {
  CONVERSIONS_MIN,
  DEPLACEMENT_MAX,
  comparer,
  observer,
  recommander,
  repartition,
  simuler,
  type Plateforme,
} from '@/server/oria/budget'

/**
 * Le budget, et la prudence qu'il exige.
 *
 * Un conseil budgétaire est le plus coûteux qu'Oria puisse donner quand il est faux : il
 * se paie en francs, tout de suite. Ces tests tiennent quatre lignes — ne rien comparer
 * sur trop peu, ne rien déplacer pour un écart de bruit, ne jamais déplacer beaucoup, et
 * ne jamais donner une projection sans fourchette ni hypothèses.
 */

function regie(
  poste: 'google' | 'meta',
  semaines: readonly [number, number, number][],
  devise = 'CHF',
): Plateforme {
  const cumuls = semaines.map(([cout, conversions, valeur]) => ({ cout, clics: conversions * 20, conversions, valeur }))
  const total = cumuls.reduce(
    (s, c) => ({ cout: s.cout + c.cout, clics: s.clics + c.clics, conversions: s.conversions + c.conversions, valeur: s.valeur + c.valeur }),
    { cout: 0, clics: 0, conversions: 0, valeur: 0 },
  )
  return { poste, nom: poste === 'google' ? 'Google Ads' : 'Meta Ads', devise, semaines: cumuls, total }
}

const semaine = (cout: number, conversions: number, valeur = 0): [number, number, number] => [cout, conversions, valeur]

describe('la comparaison des régies', () => {
  it('refuse de comparer sur trop peu de conversions', () => {
    const peu = comparer([
      regie('google', [semaine(100, 1), semaine(100, 1), semaine(100, 1), semaine(100, 1)]),
      regie('meta', [semaine(100, 5), semaine(100, 5), semaine(100, 5), semaine(100, 5)]),
    ])
    expect(peu.possible).toBe(false)
    if (!peu.possible) expect(peu.raison).toContain(String(CONVERSIONS_MIN))
  })

  it('refuse de comparer une seule régie, ou deux devises', () => {
    expect(comparer([regie('google', [semaine(100, 20)])]).possible).toBe(false)
    expect(
      comparer([regie('google', [semaine(100, 20)], 'CHF'), regie('meta', [semaine(100, 20)], 'EUR')]).possible,
    ).toBe(false)
  })

  it('ne désigne aucune gagnante pour un écart de bruit', () => {
    const proches = comparer([
      regie('google', [semaine(250, 12), semaine(250, 12), semaine(250, 12), semaine(250, 12)]),
      regie('meta', [semaine(250, 11), semaine(250, 11), semaine(250, 11), semaine(250, 11)]),
    ])
    expect(proches.possible && proches.meilleure).toBe(null)
  })

  it('compare au ROAS quand les deux remontent la valeur des ventes', () => {
    const avecValeur = comparer([
      regie('google', [semaine(250, 10, 2000), semaine(250, 10, 2000), semaine(250, 10, 2000), semaine(250, 10, 2000)]),
      regie('meta', [semaine(250, 15, 1000), semaine(250, 15, 1000), semaine(250, 15, 1000), semaine(250, 15, 1000)]),
    ])
    // Meta a plus de conversions, mais Google rapporte plus : c'est le ROAS qui décide.
    expect(avecValeur.possible && avecValeur.mesure).toBe('roas')
    expect(avecValeur.possible && avecValeur.meilleure).toBe('google')
  })
})

describe('la répartition recommandée', () => {
  const google = regie('google', [semaine(250, 20), semaine(250, 20), semaine(250, 20), semaine(250, 20)])
  const meta = regie('meta', [semaine(750, 10), semaine(750, 10), semaine(750, 10), semaine(750, 10)])

  it('ne déplace jamais plus que le plafond, même pour un écart énorme', () => {
    const budgets = { google: 250, meta: 750 }
    const reco = recommander(budgets, [google, meta], comparer([google, meta]))
    const g = reco?.parts.find((un) => un.poste === 'google')
    expect(g).toBeDefined()
    expect(Math.round(((g?.proposee ?? 0) - (g?.actuelle ?? 0)) * 100)).toBeLessThanOrEqual(DEPLACEMENT_MAX)
    expect(g?.proposee ?? 0).toBeGreaterThan(g?.actuelle ?? 0)
  })

  it('ne touche pas au contenu, que rien ne mesure', () => {
    const budgets = { google: 250, meta: 750, contenu: 500 }
    const reco = recommander(budgets, [google, meta], comparer([google, meta]))
    const contenu = reco?.parts.find((un) => un.poste === 'contenu')
    expect(contenu?.proposee).toBeCloseTo(contenu?.actuelle ?? -1)
  })

  it('ne recommande rien quand la comparaison n’est pas possible', () => {
    const seule = [google]
    expect(recommander({ google: 100 }, seule, comparer(seule))).toBeNull()
  })

  it('dit l’observation du cahier des charges quand la part va à la moins rentable', () => {
    const phrase = observer({ google: 250, meta: 750 }, comparer([google, meta]))
    expect(phrase).toContain('75 %')
    expect(phrase).toContain('Meta Ads')
    expect(phrase).toContain('aucun budget n’est modifié')
  })

  it('calcule les parts déclarées', () => {
    expect(repartition({ google: 300, meta: 700 }).map((un) => Math.round(un.part * 100))).toEqual([30, 70])
    expect(repartition({})).toEqual([])
  })
})

describe('la simulation', () => {
  it('rend une fourchette, jamais un chiffre seul, et ne dépasse pas « moyenne »', () => {
    const r = regie('meta', [semaine(200, 10), semaine(200, 8), semaine(200, 12), semaine(200, 10)])
    const s = simuler(r, 30)
    expect(s.possible).toBe(true)
    if (!s.possible) return
    expect(s.ecartDepense).toBeCloseTo(240)
    expect(s.conversions.bas).toBeLessThan(s.conversions.haut)
    expect(s.confiance).not.toBe('elevee')
    expect(s.hypotheses.join(' ')).toContain('optimiste')
  })

  it('refuse d’estimer sur trop peu', () => {
    const r = regie('meta', [semaine(200, 0), semaine(200, 1), semaine(200, 0), semaine(200, 2)])
    expect(simuler(r, 30).possible).toBe(false)
  })

  it('refuse d’estimer une régie qui ne dépense rien', () => {
    const r = regie('meta', [semaine(0, 0), semaine(0, 0), semaine(0, 0), semaine(0, 0)])
    expect(simuler(r, 30).possible).toBe(false)
  })
})
