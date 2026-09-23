import { describe, expect, it } from 'vitest'
import { SEUILS, arret, chuteTrafic, completer, envoleeCpc, rupture, type Jour } from '@/server/oria/anomalies'

/**
 * Les ruptures qu'Oria signale.
 *
 * Deux exigences opposées, et chacune a ses tests. Voir la rupture dès qu'elle est réelle —
 * un suivi cassé depuis trois jours coûte trois jours de pilotage à l'aveugle. Et se taire
 * quand elle ne l'est pas — une alerte qui crie sur trois clics apprend à ne plus lire les
 * alertes.
 */

const J = 24 * 60 * 60 * 1000
const fin = new Date('2026-09-23T00:00:00Z')

/** Une série de `n` jours jusqu'à hier, construite jour par jour. */
function serie(n: number, jour: (rang: number) => Partial<Jour>): Jour[] {
  return Array.from({ length: n }, (_, rang) => ({
    jour: new Date(+fin - (n - rang) * J),
    cout: 0,
    clics: 0,
    conversions: 0,
    ...jour(rang),
  }))
}

describe('une régie qui s’arrête net', () => {
  it('est signalée après deux jours sans dépense, quand elle dépensait', () => {
    const s = serie(29, (rang) => (rang >= 27 ? {} : { cout: 30, clics: 40 }))
    expect(arret(s, 'Meta Ads', 'CHF')?.urgence).toBe('critique')
  })

  it('ne l’est pas pour un seul jour à zéro, qui peut être une remontée tardive', () => {
    const s = serie(29, (rang) => (rang === 28 ? {} : { cout: 30 }))
    expect(arret(s, 'Meta Ads', 'CHF')).toBeNull()
  })

  it('ne l’est pas pour une régie qui dépensait presque rien', () => {
    const s = serie(29, (rang) => (rang >= 27 ? {} : { cout: SEUILS.depenseArret - 1 }))
    expect(arret(s, 'Meta Ads', 'CHF')).toBeNull()
  })
})

describe('des conversions qui tombent à zéro', () => {
  it('sont signalées quand les clics continuent : c’est le suivi', () => {
    const s = serie(29, (rang) => (rang >= 26 ? { cout: 20, clics: 30 } : { cout: 20, clics: 30, conversions: 2 }))
    const detection = rupture(s, 'Google Ads')
    expect(detection?.urgence).toBe('critique')
    expect(detection?.pourquoi).toContain('suivi')
  })

  it('ne le sont pas quand les clics s’effondrent aussi : c’est un arrêt, pas une rupture', () => {
    const s = serie(29, (rang) => (rang >= 26 ? { cout: 2, clics: 3 } : { cout: 20, clics: 30, conversions: 2 }))
    expect(rupture(s, 'Google Ads')).toBeNull()
  })

  it('ne le sont pas pour un compte qui convertissait rarement', () => {
    const s = serie(29, (rang) => (rang >= 26 ? { clics: 30 } : { clics: 30, conversions: rang % 3 === 0 ? 1 : 0 }))
    expect(rupture(s, 'Google Ads')).toBeNull()
  })
})

describe('un coût par clic qui s’envole', () => {
  it('est signalé au-delà du seuil, avec assez de clics', () => {
    const s = serie(29, (rang) => (rang >= 22 ? { cout: 30, clics: 20 } : { cout: 20, clics: 20 }))
    expect(envoleeCpc(s, 'Meta Ads', 'CHF')?.titre).toContain('coût par clic')
  })

  it('ne l’est pas sur trop peu de clics', () => {
    const s = serie(29, (rang) => (rang >= 22 ? { cout: 30, clics: 2 } : { cout: 20, clics: 2 }))
    expect(envoleeCpc(s, 'Meta Ads', 'CHF')).toBeNull()
  })
})

describe('le trafic depuis Google', () => {
  const releves = (clics: (rang: number) => number) =>
    Array.from({ length: 29 }, (_, rang) => ({ jour: new Date(+fin - (29 - rang) * J), clics: clics(rang) }))

  it('est signalé quand il chute nettement', () => {
    expect(chuteTrafic(releves((rang) => (rang >= 22 ? 5 : 20)), fin)?.titre).toContain('chuté')
  })

  it('ne l’est pas quand des jours manquent : un jour sans relevé n’est pas un jour sans clic', () => {
    const troues = releves((rang) => (rang >= 22 ? 5 : 20)).filter((_, rang) => rang !== 10)
    expect(chuteTrafic(troues, fin)).toBeNull()
  })

  it('ne l’est pas sur un petit trafic', () => {
    expect(chuteTrafic(releves((rang) => (rang >= 22 ? 0 : 2)), fin)).toBeNull()
  })
})

describe('la série', () => {
  it('complète les jours manquants de zéros, du plus ancien au plus récent', () => {
    const s = completer([{ jour: new Date(+fin - 2 * J), cout: 5, clics: 1, conversions: 0 }], fin, 3)
    expect(s.map((un) => un.cout)).toEqual([0, 5, 0])
  })
})
