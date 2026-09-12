import type { CSSProperties } from 'react'
import type { Theme } from '@/server/spec/schema'

/**
 * Traduction du thème d'une AppSpec en variables CSS.
 *
 * Les valeurs proviennent d'un schéma qui n'accepte que `#RRGGBB` et des énumérations
 * fermées : rien de ce qui arrive ici ne peut contenir de code.
 *
 * Ce fichier fait un peu plus que recopier six couleurs. Un thème décrit par un modèle
 * donne une palette correcte mais plate ; ce qui fait qu'une page a de l'allure, ce sont
 * les valeurs dérivées — un dégradé, une ombre, une couleur de texte qui reste lisible sur
 * le fond choisi. Elles sont calculées ici, une fois, plutôt que devinées à chaque bloc.
 */

const RADIUS: Record<Theme['radius'], string> = {
  none: '0px',
  small: '8px',
  medium: '14px',
  large: '22px',
}

/** Rayon des grandes surfaces : un héros ou une carte gagnent à être plus arrondis. */
const RADIUS_LARGE: Record<Theme['radius'], string> = {
  none: '0px',
  small: '12px',
  medium: '22px',
  large: '32px',
}

const FONT: Record<Theme['font'], string> = {
  system:
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  serif: "ui-serif, 'Iowan Old Style', Georgia, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Nunito', system-ui, sans-serif",
}

/** Graisse des titres : une serif a besoin de moins de gras pour avoir de la présence. */
const HEADING_WEIGHT: Record<Theme['font'], string> = {
  system: '650',
  serif: '600',
  rounded: '700',
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

/**
 * Luminance relative, au sens des règles d'accessibilité.
 *
 * Sert à une seule décision, mais une décision qui casse une page quand elle est prise au
 * hasard : écrire en blanc ou en noir sur la couleur principale. Un thème jaune pâle avec
 * du texte blanc en dur est illisible, et c'est exactement ce que faisait le code d'avant.
 */
export function luminance(hex: string): number {
  const linear = channels(hex).map((channel) => {
    const ratio = channel / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** Texte lisible posé sur une couleur donnée. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#111111' : '#ffffff'
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function mix(hex: string, towards: string, ratio: number): string {
  const a = channels(hex)
  const b = channels(towards)
  const blend = a.map((channel, index) =>
    Math.round(channel + (b[index]! - channel) * ratio),
  ) as [number, number, number]
  return `#${blend.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function themeStyle(theme: Theme): CSSProperties {
  const { primary, accent, background, surface, text, muted } = theme.colors
  const dark = theme.mode === 'dark'

  /*
   * Le dégradé part de la couleur principale et va vers l'accent, en passant par une
   * version assombrie de la principale. Deux couleurs seules donnent une bande plate ;
   * trois points donnent de la profondeur, même quand la palette est terne.
   */
  const deep = mix(primary, dark ? '#000000' : '#1a1035', 0.35)
  const gradient = `linear-gradient(135deg, ${deep} 0%, ${primary} 45%, ${accent} 100%)`

  return {
    '--app-primary': primary,
    '--app-primary-soft': withAlpha(primary, dark ? 0.22 : 0.1),
    '--app-on-primary': readableOn(primary),
    '--app-accent': accent,
    '--app-background': background,
    '--app-surface': surface,
    '--app-surface-alt': mix(surface, dark ? '#ffffff' : '#000000', 0.04),
    '--app-text': text,
    '--app-muted': muted,
    '--app-border': withAlpha(text, dark ? 0.16 : 0.1),
    '--app-gradient': gradient,
    '--app-on-gradient': readableOn(primary),
    /*
     * Voile de lisibilité posé sur une photo, dans la couleur opposée à celle du texte.
     * Une photo peut être n'importe quoi — un mur blanc, un chantier sombre — et le texte
     * doit rester lisible sur les deux. Le dégradé est plus dense en bas qu'en haut :
     * c'est là que se trouvent le sous-titre et le bouton.
     */
    '--app-scrim':
      readableOn(primary) === '#ffffff'
        ? 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 100%)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.5) 100%)',
    // Ombres douces et colorées plutôt que grises : une ombre teintée de la couleur
    // principale donne l'impression d'un objet posé, pas d'une bordure de plus.
    '--app-shadow': `0 1px 2px ${withAlpha(text, 0.05)}, 0 8px 24px -12px ${withAlpha(primary, dark ? 0.5 : 0.28)}`,
    '--app-shadow-lg': `0 2px 4px ${withAlpha(text, 0.05)}, 0 24px 60px -24px ${withAlpha(primary, dark ? 0.65 : 0.38)}`,
    '--app-radius': RADIUS[theme.radius],
    '--app-radius-lg': RADIUS_LARGE[theme.radius],
    '--app-heading-weight': HEADING_WEIGHT[theme.font],
    fontFamily: FONT[theme.font],
    background,
    color: text,
  } as CSSProperties
}
