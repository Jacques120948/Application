import { describe, expect, it } from 'vitest'
import { classer, INTENTIONS } from '@/server/audit/intentions'

/**
 * L'intention derrière une recherche.
 *
 * Search Console ne la donne pas. Elle est déduite de mots, ce qui veut dire qu'elle peut
 * se tromper — d'où la règle que ces tests protègent : on n'étiquette que ce qui porte un
 * marqueur franc, et tout le reste est de l'information. Un guide servi à quelqu'un qui
 * voulait acheter reste lisible ; une page de vente servie à quelqu'un qui voulait
 * comprendre le fait partir.
 */
describe('l’intention d’une recherche', () => {
  it('reconnaît une intention d’achat, dans les quatre langues', () => {
    expect(classer('acheter jaspe rouge')).toBe('achat')
    expect(classer('bougie obsidienne prix')).toBe('achat')
    expect(classer('rosenquarz kerze kaufen')).toBe('achat')
    expect(classer('comprare diaspro rosso')).toBe('achat')
    expect(classer('buy amethyst candle')).toBe('achat')
  })

  it('reconnaît une comparaison', () => {
    expect(classer('améthyste vs quartz rose')).toBe('comparaison')
    expect(classer('différence obsidienne et onyx')).toBe('comparaison')
    expect(classer('meilleure bougie parfumée')).toBe('comparaison')
    expect(classer('migliore candela profumata')).toBe('comparaison')
  })

  it('reconnaît une recherche de lieu', () => {
    expect(classer('bougie artisanale suisse')).toBe('local')
    expect(classer('boutique pierres genève')).toBe('achat')
    expect(classer('pierres semi précieuses lausanne')).toBe('local')
  })

  it('range dans l’information tout ce qui ne porte aucun marqueur', () => {
    /*
     * Le repli, et la raison d'être de la prudence des listes : c'est ici que tombe tout
     * ce dont on n'est pas sûr.
     */
    expect(classer('jaspe rouge vertus')).toBe('information')
    expect(classer('améthyste signification')).toBe('information')
    expect(classer('comment entretenir une bougie')).toBe('information')
    expect(classer('')).toBe('information')
  })

  it('ne se laisse pas prendre par un fragment de mot', () => {
    /*
     * « or » est un comparatif anglais, et se cache dans « original », « corail »,
     * « décoration ». La reconnaissance se fait sur des mots entiers, et ces fragments
     * sont absents des listes.
     */
    expect(classer('décoration originale corail')).toBe('information')
    expect(classer('bougie parfum bestseller')).toBe('information')
  })

  it('tranche par conséquence quand plusieurs marqueurs se croisent', () => {
    // Une requête qui dit « acheter » a décidé, où qu'elle veuille le faire.
    expect(classer('acheter jaspe rouge genève')).toBe('achat')
    expect(classer('meilleure améthyste suisse')).toBe('comparaison')
  })

  it('donne à chaque intention une phrase, pour l’écran comme pour le modèle', () => {
    for (const intention of ['achat', 'comparaison', 'local', 'information'] as const) {
      expect(INTENTIONS[intention].length).toBeGreaterThan(0)
    }
  })
})
