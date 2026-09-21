import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERIODES, periodeValide, TRIS, triValide } from '@/server/ads/tableau'
import { journeesEntre } from '@/server/ads/metriques'
import { JOURS_PREMIERE_LECTURE, JOURS_RELECTURE } from '@/server/ads/synchro'

/**
 * Le tableau de bord publicitaire et sa lecture nocturne.
 *
 * Ce qui est vérifié ici n'est pas l'affichage — il se voit — mais trois règles qui, si
 * elles se perdent, se perdent sans bruit : une période venue du navigateur ne doit jamais
 * casser un écran, la lecture doit rester frugale parce que son plafond est partagé, et une
 * journée récente doit être relue plutôt qu'empilée.
 */

describe('la période demandée', () => {
  it('accepte les durées proposées', () => {
    for (const jours of PERIODES) {
      expect(periodeValide(String(jours))).toBe(jours)
    }
  })

  it('retombe sur sept jours pour tout le reste', () => {
    /*
     * La période vient de l'adresse et n'ouvre aucun droit. Une valeur inattendue doit
     * retomber sur une valeur sûre plutôt que de faire échouer un écran qu'on venait
     * consulter — ou pire, de produire une fenêtre de mille jours chez Google.
     */
    expect(periodeValide('9999')).toBe(7)
    expect(periodeValide('0')).toBe(7)
    expect(periodeValide('-30')).toBe(7)
    expect(periodeValide('sept')).toBe(7)
    expect(periodeValide(undefined)).toBe(7)
    expect(periodeValide({ jours: 7 })).toBe(7)
  })
})

describe('l’ordre des campagnes', () => {
  it('accepte les ordres proposés', () => {
    for (const tri of TRIS) expect(triValide(tri)).toBe(tri)
  })

  it('retombe sur la dépense pour tout le reste', () => {
    /*
     * La dépense d'abord, et pas le nom : l'ordre alphabétique met en tête la campagne dont
     * le nom commence par A, ce qui n'intéresse personne. Ce qu'on veut voir en premier,
     * c'est là où part l'argent.
     */
    expect(triValide('budget')).toBe('depense')
    expect(triValide(undefined)).toBe('depense')
    expect(triValide(42)).toBe('depense')
  })
})

describe('les journées d’une fenêtre', () => {
  it('rend toutes les journées, bornes comprises', () => {
    expect(journeesEntre('2026-09-18', '2026-09-21')).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ])
  })

  it('traverse un changement de mois et une fin de février', () => {
    expect(journeesEntre('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ])
    expect(journeesEntre('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ])
  })

  it('ne rend rien quand les bornes sont inversées ou absurdes', () => {
    expect(journeesEntre('2026-09-21', '2026-09-18')).toEqual([])
    expect(journeesEntre('hier', 'demain')).toEqual([])
  })

  it('reste borné face à une fenêtre aberrante', () => {
    // Le nombre de barres d'un graphique ne doit pas dépendre d'une date mal formée.
    expect(journeesEntre('2020-01-01', '2026-01-01').length).toBeLessThanOrEqual(400)
  })
})

describe('la lecture nocturne', () => {
  it('remonte loin la première fois, et court ensuite', () => {
    /*
     * Sans historique, aucune comparaison n'est possible et le tableau ne dit qu'un état.
     * Mais relire quatre-vingt-dix jours chaque nuit serait payer très cher une information
     * qu'on possède déjà — sur un plafond partagé par tous les comptes reliés.
     */
    expect(JOURS_PREMIERE_LECTURE).toBeGreaterThanOrEqual(60)
    expect(JOURS_RELECTURE).toBeLessThan(JOURS_PREMIERE_LECTURE)
    // Assez large pour couvrir les révisions de Google, qui portent sur quelques jours.
    expect(JOURS_RELECTURE).toBeGreaterThanOrEqual(7)
  })

  it('tient en deux appels par compte, quoi qu’il arrive', () => {
    /*
     * La règle qui protège tout le monde : le plafond appartient au projet Google Cloud
     * d'Evoliia et se partage. Une boucle par campagne coûterait à tous ce qu'elle ferait
     * gagner à un seul — et elle passerait inaperçue jusqu'au jour où le plafond tombe.
     */
    const source = readFileSync('src/server/ads/synchro.ts', 'utf8')
    expect(source).toContain('appels: 2')
    // Les lectures Google ne sont appelées qu'une fois chacune.
    expect(source.match(/googleAds\.lireCampagnes\(/gu) ?? []).toHaveLength(1)
    expect(source.match(/googleAds\.lireJournees\(/gu) ?? []).toHaveLength(1)
  })

  it('réécrit les journées au lieu de les empiler', () => {
    /*
     * Google corrige ses conversions pendant plusieurs jours : une vente d'aujourd'hui peut
     * être rattachée à un clic de mardi. Une journée figée le soir même serait fausse le
     * lendemain — et c'est exactement le chiffre sur lequel une recommandation
     * s'appuierait.
     */
    const source = readFileSync('src/server/ads/synchro.ts', 'utf8')
    expect(source).toContain('tx.adsReleve.upsert')
    expect(source).not.toContain('tx.adsReleve.create(')
  })
})
