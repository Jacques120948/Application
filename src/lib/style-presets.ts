import type { Theme } from '@/server/spec/schema'

/**
 * Styles complets, prêts à l'emploi.
 *
 * Un style n'est pas une palette : c'est une palette, une paire de polices, une forme, un
 * motif de fond et une respiration qui vont ensemble. Six couleurs choisies par un modèle
 * donnent une page correcte ; un style choisi ici donne une page qui a l'air décidée.
 * Le créateur peut ensuite retoucher chaque réglage à la main.
 */
export type StylePreset = {
  id: string
  label: string
  /** Pour qui, en une phrase. */
  hint: string
  theme: Theme
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'confiance',
    label: 'Confiance',
    hint: 'Bleu net, formes sobres. Services, outils, gestion.',
    theme: {
      colors: { primary: '#2563EB', accent: '#0EA5E9', background: '#FFFFFF', surface: '#F4F7FB', text: '#0F172A', muted: '#64748B' },
      radius: 'medium',
      font: 'geometric',
      mode: 'light',
      pattern: 'grid',
      density: 'balanced',
    },
  },
  {
    id: 'nature',
    label: 'Nature',
    hint: 'Verts profonds, rondeurs. Bien-être, alimentation, extérieur.',
    theme: {
      colors: { primary: '#15803D', accent: '#65A30D', background: '#FDFDF9', surface: '#F1F7F0', text: '#14261A', muted: '#5F7367' },
      radius: 'large',
      font: 'rounded',
      mode: 'light',
      pattern: 'blobs',
      density: 'airy',
    },
  },
  {
    id: 'chaleur',
    label: 'Chaleur',
    hint: 'Terracotta et crème. Artisanat, restauration, local.',
    theme: {
      colors: { primary: '#C2410C', accent: '#EA580C', background: '#FFFBF7', surface: '#FDF0E6', text: '#27180F', muted: '#7A6255' },
      radius: 'large',
      font: 'editorial',
      mode: 'light',
      pattern: 'dots',
      density: 'balanced',
    },
  },
  {
    id: 'elegance',
    label: 'Élégance',
    hint: 'Violet profond, titres en serif. Mode, beauté, événements.',
    theme: {
      colors: { primary: '#4C1D95', accent: '#7C3AED', background: '#FFFFFF', surface: '#F6F3FB', text: '#1E1B2E', muted: '#6B6480' },
      radius: 'small',
      font: 'elegant',
      mode: 'light',
      pattern: 'lines',
      density: 'airy',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    hint: 'Noir, blanc, une seule couleur d’accent. Studios, portfolios, conseil.',
    theme: {
      colors: { primary: '#111111', accent: '#F59E0B', background: '#FFFFFF', surface: '#F5F5F4', text: '#111111', muted: '#737373' },
      radius: 'none',
      font: 'system',
      mode: 'light',
      pattern: 'none',
      density: 'airy',
    },
  },
  {
    id: 'nuit',
    label: 'Nuit',
    hint: 'Fond sombre, accents lumineux. Technologie, musique, gaming.',
    theme: {
      colors: { primary: '#818CF8', accent: '#22D3EE', background: '#0B0F1A', surface: '#151B2B', text: '#EEF2FF', muted: '#8B93B0' },
      radius: 'medium',
      font: 'bold',
      mode: 'dark',
      pattern: 'grid',
      density: 'balanced',
    },
  },
  {
    id: 'audace',
    label: 'Audace',
    hint: 'Couleurs franches, gros titres. Sport, lancement, jeunesse.',
    theme: {
      colors: { primary: '#DB2777', accent: '#F97316', background: '#FFFFFF', surface: '#FFF1F7', text: '#1F0A14', muted: '#7C5468' },
      radius: 'large',
      font: 'bold',
      mode: 'light',
      pattern: 'blobs',
      density: 'compact',
    },
  },
  {
    id: 'douceur',
    label: 'Douceur',
    hint: 'Pastels et rondeurs. Enfants, famille, loisirs créatifs.',
    theme: {
      colors: { primary: '#0891B2', accent: '#F472B6', background: '#FBFDFF', surface: '#EEF8FB', text: '#0F2A33', muted: '#5D7C86' },
      radius: 'large',
      font: 'playful',
      mode: 'light',
      pattern: 'dots',
      density: 'balanced',
    },
  },
]

export const STYLE_PRESET_IDS = ['confiance', 'nature', 'chaleur', 'elegance', 'minimal', 'nuit', 'audace', 'douceur'] as const

/** Les thèmes par identifiant de style, pour ceux qui ne veulent que la valeur. */
export const THEME_PRESETS: Record<string, Theme> = Object.fromEntries(
  STYLE_PRESETS.map((preset) => [preset.id, preset.theme]),
)

