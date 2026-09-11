import type { CSSProperties } from 'react'
import type { Theme } from '@/server/spec/schema'

/**
 * Traduction du thème d'une AppSpec en variables CSS.
 *
 * Les valeurs proviennent d'un schéma qui n'accepte que `#RRGGBB` et des énumérations
 * fermées : rien de ce qui arrive ici ne peut contenir de code.
 */

const RADIUS: Record<Theme['radius'], string> = {
  none: '0px',
  small: '6px',
  medium: '12px',
  large: '20px',
}

const FONT: Record<Theme['font'], string> = {
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif",
}

export function themeStyle(theme: Theme): CSSProperties {
  return {
    '--app-primary': theme.colors.primary,
    '--app-accent': theme.colors.accent,
    '--app-background': theme.colors.background,
    '--app-surface': theme.colors.surface,
    '--app-text': theme.colors.text,
    '--app-muted': theme.colors.muted,
    '--app-radius': RADIUS[theme.radius],
    fontFamily: FONT[theme.font],
    background: theme.colors.background,
    color: theme.colors.text,
  } as CSSProperties
}
