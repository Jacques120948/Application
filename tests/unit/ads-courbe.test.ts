import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CourbeAds, type JourneeVue } from '@/components/studio/CourbeAds'

/**
 * La courbe, et la seule façon dont un graphique écrit à la main casse en silence.
 *
 * Une division par zéro ne fait pas échouer un SVG : elle écrit `x="NaN"`, le navigateur
 * ignore la forme, et la page s'affiche avec un cadre vide au milieu. Rien dans les journaux,
 * rien dans les tests d'affichage. D'où ce contrôle, qui ne juge pas l'esthétique mais
 * vérifie qu'aucune coordonnée n'est invalide, pour des périodes d'un jour à quatre-vingt-dix.
 */

function serie(nombre: number, cout: (index: number) => number): JourneeVue[] {
  return Array.from({ length: nombre }, (_, index) => ({
    jour: `2026-09-${String((index % 30) + 1).padStart(2, '0')}`,
    cout: cout(index),
    valeur: cout(index) * 3,
    conversions: 0,
    clics: 0,
    roas: cout(index) === 0 ? null : 300,
  }))
}

function rendre(journees: JourneeVue[]): string {
  return renderToStaticMarkup(createElement(CourbeAds, { serie: journees, devise: 'CHF' }))
}

describe('la courbe publicitaire', () => {
  it('ne produit aucune coordonnée invalide, quelle que soit la période', () => {
    for (const nombre of [2, 7, 14, 30, 90]) {
      const html = rendre(serie(nombre, (index) => (index % 3 === 0 ? 0 : index * 2)))
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('Infinity')
      expect(html).toContain('<svg')
    }
  })

  it('survit à une seule journée qui dépense, toutes les autres à zéro', () => {
    // Le cas qui divise par zéro : un maximum atteint par un seul point.
    const html = rendre(serie(30, (index) => (index === 12 ? 42 : 0)))
    expect(html).not.toContain('NaN')
    expect(html).toContain('<svg')
  })

  it('le dit plutôt que de dessiner un cadre vide quand rien n’a été dépensé', () => {
    const html = rendre(serie(7, () => 0))
    expect(html).not.toContain('<svg')
    expect(html).toContain('rien à tracer')
  })

  it('ne dessine rien avec moins de deux journées : une barre n’est pas une courbe', () => {
    expect(rendre(serie(1, () => 10))).toBe('')
  })
})
