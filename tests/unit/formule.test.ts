import { describe, expect, it } from 'vitest'
import {
  evaluateFormula,
  formulaFields,
  FormulaError,
  MAX_FORMULA_LENGTH,
  parseFormula,
} from '@/lib/formula'

/**
 * Les formules de calcul.
 *
 * Deux propriétés valent plus que toutes les autres, et ce sont celles qu'on éprouve le
 * plus ici : la grammaire n'accepte que du calcul — une formule est écrite par un modèle de
 * langage à partir d'une demande d'utilisateur — et une donnée manquante donne « rien »,
 * jamais zéro.
 */

const calcule = (source: string, values: Record<string, unknown>) =>
  evaluateFormula(parseFormula(source), values)

describe('ce que la grammaire accepte', () => {
  it('les quatre opérations, avec les bonnes priorités', () => {
    expect(calcule('2 + 3 * 4', {})).toBe(14)
    expect(calcule('(2 + 3) * 4', {})).toBe(20)
    expect(calcule('10 / 4', {})).toBe(2.5)
    expect(calcule('10 - 3 - 2', {})).toBe(5)
  })

  it('les champs du modèle', () => {
    expect(calcule('prix * quantite', { prix: 12.5, quantite: 4 })).toBe(50)
    expect(formulaFields(parseFormula('prix * quantite + prix'))).toEqual(['prix', 'quantite'])
  })

  it('le signe moins devant un terme', () => {
    expect(calcule('-prix + 100', { prix: 30 })).toBe(70)
  })

  it('la virgule décimale, comme on l’écrit en français', () => {
    expect(calcule('prix * 1,2', { prix: 100 })).toBe(120)
  })

  it('les nombres enregistrés sous forme de texte', () => {
    expect(calcule('prix * quantite', { prix: '12.5', quantite: '4' })).toBe(50)
  })

  it('arrondit au centime plutôt que d’exhiber les flottants', () => {
    expect(calcule('0,1 + 0,2', {})).toBe(0.3)
  })
})

describe('ce que la grammaire refuse', () => {
  const refusees = [
    '',
    'prix +',
    '(prix * 2',
    'prix ** 2',
    'prix; DROP TABLE',
    'process.exit(1)',
    'fetch("http://x")',
    'prix->quantite',
    '2 3',
    'x'.repeat(MAX_FORMULA_LENGTH + 1),
  ]

  for (const source of refusees) {
    it(`refuse « ${source.slice(0, 30)} »`, () => {
      expect(() => parseFormula(source)).toThrow(FormulaError)
    })
  }

  it('refuse une imbrication démesurée sans faire exploser la pile', () => {
    expect(() => parseFormula('('.repeat(40) + '1' + ')'.repeat(40))).toThrow(FormulaError)
  })
})

describe('une donnée manquante ne vaut pas zéro', () => {
  it('rend « rien » quand un champ est absent', () => {
    expect(calcule('prix * quantite', { prix: 10 })).toBeNull()
  })

  it('rend « rien » quand un champ n’est pas un nombre', () => {
    expect(calcule('prix * 2', { prix: 'gratuit' })).toBeNull()
  })

  it('rend « rien » plutôt que l’infini sur une division par zéro', () => {
    expect(calcule('prix / quantite', { prix: 10, quantite: 0 })).toBeNull()
  })

  it('distingue bien « rien » de zéro', () => {
    expect(calcule('prix * quantite', { prix: 0, quantite: 4 })).toBe(0)
  })
})
