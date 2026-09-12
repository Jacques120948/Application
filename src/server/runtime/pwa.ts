import type { AppSpec } from '@/server/spec/schema'

/**
 * Installation d'une application publiée depuis le navigateur.
 *
 * Ni l'App Store ni Google Play ne sont nécessaires pour qu'une application ait une icône
 * sur l'écran d'accueil, s'ouvre sans barre d'adresse et garde sa couleur. C'est gratuit,
 * immédiat, et cela vaut sur les deux systèmes. Les magasins viendront après, s'ils
 * viennent : ils demandent un compte payant, des fonctions natives réelles et, du côté de
 * Google, douze testeurs pendant quatorze jours.
 *
 * Chaque application publiée a son propre manifeste et sa propre portée, sous `/a/<slug>/`.
 * Deux applications du même créateur ne se marchent donc jamais dessus, et installer l'une
 * n'installe pas l'autre.
 */

export function appScope(slug: string): string {
  return `/a/${slug}/`
}

/**
 * Initiales affichées sur l'icône.
 *
 * Deux lettres au plus : au-delà, sur une icône de téléphone, plus rien n'est lisible.
 * Les mots courants sont ignorés pour que « Le Carnet du Boulanger » donne « CB » et non
 * « LC ».
 */
export function initials(name: string): string {
  const skip = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'my', 'the'])
  const words = name
    .split(/[\s'’-]+/)
    .map((word) => word.trim())
    // Les élisions d'une lettre sont écartées aussi : « Fiches d'Artisan » donne « FA »,
    // pas « FD ». Un « d » seul sur une icône ne dit rien de l'application.
    .filter((word) => word.length > 1 && !skip.has(word.toLowerCase()))
  if (words.length === 0) return name.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

/** Couleur de texte lisible sur un fond donné, par luminance relative. */
function readableOn(hex: string): string {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => {
    const ratio = Number.parseInt(value.slice(offset, offset + 2), 16) / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  return luminance > 0.45 ? '#111111' : '#ffffff'
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Icône de l'application, dessinée depuis son thème.
 *
 * Aucune image n'est demandée au créateur : une application sans icône ne serait pas
 * installable, et réclamer un fichier carré de 512 pixels avant de pouvoir essayer serait
 * une marche de plus à monter. Le dégradé et les initiales suffisent à ce qu'on reconnaisse
 * son application parmi les autres sur un écran d'accueil.
 *
 * `padded` réserve la marge qu'Android découpe sur les icônes adaptatives : sans elle, les
 * initiales seraient rognées par le masque rond de certains téléphones.
 */
export function iconSvg(spec: AppSpec, size: number, padded: boolean): string {
  const { primary, accent } = spec.theme.colors
  const text = readableOn(primary)
  const letters = escapeXml(initials(spec.name))

  // La zone sûre d'une icône adaptative est un cercle des quatre cinquièmes de la surface.
  const inset = padded ? size * 0.1 : 0
  const inner = size - inset * 2
  const radius = padded ? inner * 0.5 : inner * 0.22

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${accent}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="${primary}"/>
  <rect x="${inset}" y="${inset}" width="${inner}" height="${inner}" rx="${radius}" fill="url(#g)"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        font-size="${inner * 0.42}" font-weight="700" fill="${text}">${letters}</text>
</svg>`
}

export type WebManifest = {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: 'standalone'
  orientation: 'portrait'
  theme_color: string
  background_color: string
  lang: string
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>
}

export function buildManifest(spec: AppSpec, slug: string): WebManifest {
  const scope = appScope(slug)
  return {
    name: spec.name,
    // Le nom court est celui qui s'affiche sous l'icône : au-delà d'une douzaine de
    // caractères, le système le tronque lui-même, et mal.
    short_name: spec.name.slice(0, 12),
    description: spec.tagline,
    start_url: scope,
    scope,
    display: 'standalone',
    orientation: 'portrait',
    theme_color: spec.theme.colors.primary,
    background_color: spec.theme.colors.background,
    lang: spec.locale,
    icons: [
      { src: `${scope}icone/192`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${scope}icone/512`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${scope}icone/512?masque=1`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

/** Tailles d'icône servies. Une liste fermée : une taille libre serait un calcul offert. */
export const ICON_SIZES = [180, 192, 512] as const
export type IconSize = (typeof ICON_SIZES)[number]

export function isIconSize(value: number): value is IconSize {
  return (ICON_SIZES as readonly number[]).includes(value)
}
