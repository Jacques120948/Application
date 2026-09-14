/**
 * Icônes des applications créées.
 *
 * Un jeu fermé, dessiné au trait, en SVG 24 × 24. Chaque icône est une chaîne de balises
 * SVG **écrite ici**, jamais fournie par un modèle ni par un créateur : le nom seul voyage
 * dans l'AppSpec, et un nom inconnu tombe sur l'étincelle. Le même dessin sert au rendu
 * en ligne et à l'export statique.
 */

export const ICON_NAMES = [
  'spark',
  'star',
  'heart',
  'shield',
  'clock',
  'calendar',
  'check',
  'chat',
  'mail',
  'phone',
  'pin',
  'camera',
  'music',
  'book',
  'cart',
  'card',
  'gift',
  'globe',
  'home',
  'leaf',
  'lock',
  'rocket',
  'search',
  'settings',
  'tag',
  'tool',
  'truck',
  'user',
  'users',
  'bolt',
  'chart',
  'cup',
  'smile',
  'sun',
  'bell',
  'flag',
  'pen',
  'image',
  'play',
  'target',
] as const

export type IconName = (typeof ICON_NAMES)[number]

export const ICON_LABELS: Record<IconName, string> = {
  spark: 'Étincelle',
  star: 'Étoile',
  heart: 'Cœur',
  shield: 'Bouclier',
  clock: 'Horloge',
  calendar: 'Calendrier',
  check: 'Coche',
  chat: 'Bulle',
  mail: 'Enveloppe',
  phone: 'Téléphone',
  pin: 'Épingle',
  camera: 'Appareil photo',
  music: 'Musique',
  book: 'Livre',
  cart: 'Panier',
  card: 'Carte bancaire',
  gift: 'Cadeau',
  globe: 'Globe',
  home: 'Maison',
  leaf: 'Feuille',
  lock: 'Cadenas',
  rocket: 'Fusée',
  search: 'Loupe',
  settings: 'Réglages',
  tag: 'Étiquette',
  tool: 'Outil',
  truck: 'Camion',
  user: 'Personne',
  users: 'Groupe',
  bolt: 'Éclair',
  chart: 'Courbe',
  cup: 'Tasse',
  smile: 'Sourire',
  sun: 'Soleil',
  bell: 'Cloche',
  flag: 'Drapeau',
  pen: 'Stylo',
  image: 'Image',
  play: 'Lecture',
  target: 'Cible',
}

/** Contenu SVG de chaque icône (trait courant, sans remplissage). */
export const ICON_PATHS: Record<IconName, string> = {
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  shield: '<path d="M12 3 5 6v5c0 5 3 8.5 7 10 4-1.5 7-5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  chat: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h14"/>',
  cart: '<path d="M3 4h2l2.4 11h11l2-8H6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14h4"/>',
  gift: '<rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  home: '<path d="m4 11 8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19c3-4 6-7 10-9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  rocket: '<path d="M14 4c3 0 6 3 6 6-3 6-8 9-8 9l-4-4s3-5 6-11z"/><path d="M9 15 5 19M8 10l-3 1 2 2M14 16l-1 3 2-2"/><circle cx="14.5" cy="9.5" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  tag: '<path d="m4 12 8-8h8v8l-8 8z"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  tool: '<path d="M14 6a4 4 0 0 0 5 5l-8 8a2.1 2.1 0 0 1-3-3l8-8z"/><path d="m5 19 1-1"/>',
  truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 13.5a6 6 0 0 1 3.5 6.5"/>',
  bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-5 3 3 5-6"/>',
  cup: '<path d="M5 8h11v6a5 5 0 0 1-10 0z"/><path d="M16 9h2a2.5 2.5 0 0 1 0 5h-2M4 20h13"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  flag: '<path d="M5 21V4"/><path d="M5 5h12l-2 3.5 2 3.5H5"/>',
  pen: '<path d="m4 20 1-4L16 5l3 3L8 19z"/><path d="m13 8 3 3"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="m21 16-5-5-8 8"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
}

export function iconPath(name: string | undefined): string {
  return ICON_PATHS[(name ?? 'spark') as IconName] ?? ICON_PATHS.spark
}

/** L'icône complète, en SVG, pour un rendu sans React (export statique). */
export function iconSvg(name: string | undefined, size = 22): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPath(name)}</svg>`
}
