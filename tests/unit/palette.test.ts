import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { luminance } from '@/components/runtime/theme'

/**
 * La palette de la plateforme, vérifiée plutôt que promise.
 *
 * Elle vient de l'icône Evoliia, qui traverse tout le spectre : jaune, orange, rose,
 * magenta, violet. C'est une palette de réseau social, et c'est voulu — mais un jaune
 * n'est pas une couleur de bouton, et rien dans une feuille de style ne le dit. Les
 * commentaires de `globals.css` posent la règle ; ces tests la tiennent.
 *
 * Le seuil est celui de la recommandation d'accessibilité pour un texte courant, 4,5:1.
 */

const css = readFileSync('src/app/globals.css', 'utf8')

function jeton(nom: string): string {
  const trouve = new RegExp(`${nom}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (trouve === null) throw new Error(`jeton ${nom} introuvable dans globals.css`)
  return trouve[1]!
}

function contraste(a: string, b: string): number {
  const [haut, bas] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (haut + 0.05) / (bas + 0.05)
}

function melange(a: string, b: string, part: number): string {
  const lire = (hex: string, index: number) =>
    Number.parseInt(hex.replace('#', '').slice(index * 2, index * 2 + 2), 16)
  const canal = (index: number) =>
    Math.round(lire(a, index) + (lire(b, index) - lire(a, index)) * part)
  return `#${[0, 1, 2].map((i) => canal(i).toString(16).padStart(2, '0')).join('')}`
}

/** Arrêts d'un dégradé déclaré dans `:root`, dans l'ordre. */
function arrets(nom: string): string[] {
  const bloc = new RegExp(`--${nom}:([^;]*);`, 's').exec(css)
  if (bloc === null) throw new Error(`dégradé ${nom} introuvable`)
  return bloc[1]!.match(/#[0-9a-fA-F]{6}/g) ?? []
}

/** Pire contraste rencontré en parcourant un dégradé, texte blanc posé dessus. */
function pireContrasteBlanc(stops: string[]): number {
  let pire = Number.POSITIVE_INFINITY
  for (let i = 0; i < stops.length - 1; i++) {
    for (let pas = 0; pas <= 20; pas++) {
      pire = Math.min(pire, contraste('#ffffff', melange(stops[i]!, stops[i + 1]!, pas / 20)))
    }
  }
  return pire
}

describe('palette de la plateforme', () => {
  it('garde une couleur d’action lisible en texte comme en bouton', () => {
    expect(contraste(jeton('--color-brand'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contraste(jeton('--color-brand-strong'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('garde les textes lisibles sur le fond de page', () => {
    const canvas = jeton('--color-canvas')
    expect(contraste(jeton('--color-ink'), canvas)).toBeGreaterThanOrEqual(7)
    expect(contraste(jeton('--color-ink-soft'), canvas)).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * Le vrai piège de cette palette. Ajouter l'orange ou le jaune au dégradé des boutons
   * est tentant — c'est plus joli, et le libellé blanc devient illisible au passage.
   */
  it('garde un libellé blanc lisible sur toute la longueur du bouton', () => {
    const stops = arrets('gradient-cta')
    expect(stops.length).toBeGreaterThanOrEqual(2)
    expect(pireContrasteBlanc(stops)).toBeGreaterThanOrEqual(4.5)
  })

  /**
   * Le spectre complet est décoratif. On vérifie qu'il le reste : s'il devenait assez
   * sombre partout pour porter du texte, quelqu'un finirait par y en poser.
   */
  it('garde le spectre complet trop clair par endroits pour porter du texte', () => {
    expect(pireContrasteBlanc(arrets('gradient-brand'))).toBeLessThan(4.5)
  })

  it('n’emploie plus l’ancienne palette bleu nuit', () => {
    const anciennes = ['#5b4be8', '#4436c9', '#0e1235', '#0b1033', '#22b8e6']
    expect(anciennes.filter((couleur) => css.toLowerCase().includes(couleur))).toEqual([])
  })
})
