import { describe, expect, it } from 'vitest'
import { budgetEnCentimes, STATUTS_ECRITS } from '@/server/ads/meta-ads-ecriture'
import { budgetEnMicros } from '@/server/ads/meta-ads'

/**
 * La conversion qui peut coûter cent fois trop cher.
 *
 * Meta lit les budgets en centimes entiers et les dépenses en unités décimales — deux
 * conventions dans la même API. Les confondre à l'écriture ne produit pas une erreur : elle
 * produit un budget accepté, cent fois trop grand ou cent fois trop petit, qui dépense toute
 * la nuit avant que quiconque ouvre l'écran.
 *
 * C'est la seule conversion du module d'écriture, elle est faite à un seul endroit, et ce
 * fichier est la raison pour laquelle on peut le dire.
 */

describe('un budget envoyé chez Meta', () => {
  it('part en centimes, pas en unités ni en micros', () => {
    // 40 CHF = 40 000 000 micros = 4 000 centimes.
    expect(budgetEnCentimes(40_000_000)).toBe(4_000)
    expect(budgetEnCentimes(1_000_000)).toBe(100)
  })

  it('fait l’aller-retour exact avec la lecture', () => {
    /*
     * La propriété qui compte vraiment : ce qu'on écrit doit se relire à l'identique. Sans
     * elle, la valeur d'avant conservée au journal ne correspondrait plus à ce que Meta
     * rend, et le bouton « remettre comme avant » serait refusé sans qu'on comprenne.
     */
    for (const micros of [1_000_000, 12_500_000, 40_000_000, 999_990_000]) {
      expect(budgetEnMicros(budgetEnCentimes(micros))).toBe(micros)
    }
  })

  it('arrondit vers le bas plutôt qu’au plus proche', () => {
    /*
     * Un centime de plus ne se voit pas à l'écran, et fait pourtant échouer la
     * revérification de la valeur d'avant au retour arrière.
     */
    expect(budgetEnCentimes(40_009_999)).toBe(4_000)
  })

  it('ne descend jamais à zéro', () => {
    // Meta refuse un budget nul : mieux vaut un centime qu'un appel qui échoue.
    expect(budgetEnCentimes(0)).toBe(1)
    expect(budgetEnCentimes(-5)).toBe(1)
  })
})

describe('les statuts qu’Evoliia sait poser', () => {
  it('se limitent à la pause et à la reprise', () => {
    /*
     * Aucune suppression : Meta ne sait pas la défaire. Une borne posée dans le type plutôt
     * que dans une intention — on ne peut pas envoyer DELETED sans changer ce tableau.
     */
    expect([...STATUTS_ECRITS]).toEqual(['PAUSED', 'ACTIVE'])
  })
})
