/**
 * Paires de polices des applications créées.
 *
 * Une application qui a de l'allure se reconnaît d'abord à sa typographie : un titre et un
 * texte courant qui ne sont pas la police du système. Les polices sont **auto-hébergées**
 * (paquets Fontsource, fichiers servis par Evoliia) : aucun appel vers Google Fonts, donc
 * aucune adresse de visiteur envoyée à un tiers, et aucune dépendance réseau au rendu.
 *
 * Ce module ne contient que des données : il est lu par le moteur de rendu, par le panneau
 * Design, par l'export statique et par les prompts. Les feuilles de style, elles, sont
 * importées une fois pour toutes dans la mise en page racine.
 */

export type FontFace = {
  /** Nom de famille tel que déclaré par la feuille de style Fontsource. */
  family: string
  /** Paquet npm, absent pour une police du système. */
  pkg?: string
  /** Fichier woff2 du sous-ensemble latin, pour l'export statique. */
  file?: string
  /** Familles de repli, du système. */
  fallback: string
}

export type FontPairing = {
  id: string
  label: string
  /** Une phrase pour choisir sans connaître les noms de polices. */
  hint: string
  heading: FontFace
  body: FontFace
  /** Graisse des titres : une serif a besoin de moins de gras pour avoir de la présence. */
  headingWeight: string
  /** Interlettrage des grands titres. Négatif : plus compact, plus affirmé. */
  headingTracking: string
}

const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
const SERIF = "ui-serif, 'Iowan Old Style', Georgia, 'Times New Roman', serif"
const ROUNDED = "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', system-ui, sans-serif"

const face = (family: string, pkg: string, file: string, fallback: string): FontFace => ({
  family,
  pkg,
  file,
  fallback,
})

const INTER = face('Inter Variable', 'inter', 'inter-latin-wght-normal.woff2', SANS)
const NUNITO = face('Nunito Variable', 'nunito', 'nunito-latin-wght-normal.woff2', ROUNDED)
const LORA = face('Lora Variable', 'lora', 'lora-latin-wght-normal.woff2', SERIF)

export const FONT_PAIRINGS: readonly FontPairing[] = [
  {
    id: 'system',
    label: 'Moderne',
    hint: 'La police de l’appareil : neutre, rapide, passe-partout.',
    heading: { family: 'system-ui', fallback: SANS },
    body: { family: 'system-ui', fallback: SANS },
    headingWeight: '650',
    headingTracking: '-0.02em',
  },
  {
    id: 'serif',
    label: 'Classique',
    hint: 'Une serif posée, pour un ton sérieux et durable.',
    heading: LORA,
    body: LORA,
    headingWeight: '600',
    headingTracking: '-0.01em',
  },
  {
    id: 'rounded',
    label: 'Chaleureuse',
    hint: 'Des formes rondes et amicales.',
    heading: NUNITO,
    body: NUNITO,
    headingWeight: '750',
    headingTracking: '-0.015em',
  },
  {
    id: 'elegant',
    label: 'Élégante',
    hint: 'Titres en serif à contraste, texte sobre. Mode, beauté, hôtellerie.',
    heading: face('Playfair Display Variable', 'playfair-display', 'playfair-display-latin-wght-normal.woff2', SERIF),
    body: face('DM Sans Variable', 'dm-sans', 'dm-sans-latin-wght-normal.woff2', SANS),
    headingWeight: '600',
    headingTracking: '-0.01em',
  },
  {
    id: 'geometric',
    label: 'Géométrique',
    hint: 'Titres nets et modernes. Technologie, services, produits.',
    heading: face('Outfit Variable', 'outfit', 'outfit-latin-wght-normal.woff2', SANS),
    body: face('Manrope Variable', 'manrope', 'manrope-latin-wght-normal.woff2', SANS),
    headingWeight: '650',
    headingTracking: '-0.025em',
  },
  {
    id: 'editorial',
    label: 'Éditoriale',
    hint: 'Une serif expressive pour les titres, comme un magazine. Contenu, culture, artisanat.',
    heading: face('Fraunces Variable', 'fraunces', 'fraunces-latin-wght-normal.woff2', SERIF),
    body: INTER,
    headingWeight: '600',
    headingTracking: '-0.02em',
  },
  {
    id: 'playful',
    label: 'Ludique',
    hint: 'Ronde et joyeuse. Enfants, loisirs, alimentation.',
    heading: face('Fredoka Variable', 'fredoka', 'fredoka-latin-wght-normal.woff2', ROUNDED),
    body: NUNITO,
    headingWeight: '600',
    headingTracking: '-0.01em',
  },
  {
    id: 'bold',
    label: 'Audacieuse',
    hint: 'Grotesque affirmée, très présente. Sport, musique, lancement.',
    heading: face('Space Grotesk Variable', 'space-grotesk', 'space-grotesk-latin-wght-normal.woff2', SANS),
    body: INTER,
    headingWeight: '700',
    headingTracking: '-0.03em',
  },
]

export const FONT_IDS = ['system', 'serif', 'rounded', 'elegant', 'geometric', 'editorial', 'playful', 'bold'] as const
export type FontId = (typeof FONT_IDS)[number]

export function fontPairing(id: string): FontPairing {
  return FONT_PAIRINGS.find((pairing) => pairing.id === id) ?? FONT_PAIRINGS[0]!
}

/** Déclaration CSS d'une police : le nom de famille, puis ses replis. */
export function fontStack(font: FontFace): string {
  return font.pkg === undefined ? font.fallback : `'${font.family}', ${font.fallback}`
}

/** Les fichiers de police qu'une application utilise, sans doublon. */
export function fontFiles(id: string): Array<{ family: string; pkg: string; file: string }> {
  const pairing = fontPairing(id)
  const files: Array<{ family: string; pkg: string; file: string }> = []
  for (const font of [pairing.heading, pairing.body]) {
    if (font.pkg === undefined || font.file === undefined) continue
    if (files.some((entry) => entry.file === font.file)) continue
    files.push({ family: font.family, pkg: font.pkg, file: font.file })
  }
  return files
}

/** Motifs décoratifs de fond, dessinés en CSS : aucune image à charger. */
export const PATTERNS = ['blobs', 'dots', 'grid', 'lines', 'none'] as const
export type PatternId = (typeof PATTERNS)[number]

export const PATTERN_LABELS: Record<PatternId, string> = {
  blobs: 'Halos lumineux',
  dots: 'Points',
  grid: 'Grille fine',
  lines: 'Lignes diagonales',
  none: 'Aucun',
}

/** Respiration des sections : l'espace vertical entre les blocs. */
export const DENSITIES = ['airy', 'balanced', 'compact'] as const
export type DensityId = (typeof DENSITIES)[number]

export const DENSITY_LABELS: Record<DensityId, string> = {
  airy: 'Aérée',
  balanced: 'Équilibrée',
  compact: 'Compacte',
}
