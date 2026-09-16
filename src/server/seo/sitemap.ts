import { publicAppUrl } from '@/lib/apps-domain'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/config'
import { HOME_PATH } from '@/server/spec/validate'
import { isIndexable } from './visibility'
import type { AppSpec } from '@/server/spec/schema'

/**
 * Ce que les moteurs de recherche ont le droit de lire.
 *
 * Deux sites cohabitent sur le même code, et ils n'ont pas du tout les mêmes règles.
 *
 * **Evoliia** veut être trouvée : sa vitrine, ses offres, ses mentions légales. Tout le
 * reste — l'atelier, le tableau de bord, les aperçus de brouillons — n'a rien à faire dans
 * un index. Un aperçu indexé, c'est le brouillon d'un créateur qui sort dans Google avant
 * même qu'il ait publié.
 *
 * **Les applications créées** veulent être trouvées pour elles-mêmes, pas pour Evoliia.
 * Chacune déclare donc son propre plan de site, limité à ses pages publiques : une page
 * réservée aux personnes connectées ne montrerait à un robot qu'un formulaire de
 * connexion, et se ferait classer comme telle.
 *
 * Aucun secret ici, aucune donnée de visiteur : uniquement des adresses déjà publiques.
 */

/** Les chemins de l'atelier : utiles à qui est connecté, inutiles à un index. */
export const PRIVATE_PATHS = [
  'dashboard',
  'projets',
  'creer',
  'objectif',
  'demarrer',
  'idees',
  'radar',
  'equipe',
  'connexions',
  'abonnement',
  'administration',
  'mot-de-passe',
] as const

/** Les pages publiques d'Evoliia, dans l'ordre où elles comptent. */
export const PUBLIC_PATHS = [
  '',
  'inscription',
  'connexion',
  'conditions',
  'confidentialite',
  'mentions-legales',
] as const

export type SitemapEntry = {
  url: string
  lastModified?: Date
  changeFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  priority?: number
  alternates?: { languages: Record<string, string> }
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/$/, '')
  return path === '' ? trimmed : `${trimmed}/${path}`
}

/** L'adresse d'une page d'Evoliia dans une langue donnée. */
function evoliiaUrl(base: string, locale: Locale, path: string): string {
  return joinUrl(base, path === '' ? locale : `${locale}/${path}`)
}

/**
 * Le plan du site d'Evoliia : chaque page publique, dans chaque langue, chacune renvoyant
 * vers ses traductions. Sans ces renvois, cinq adresses proches se feraient concurrence
 * au lieu de se compléter.
 */
export function evoliiaSitemap(base: string, now = new Date()): SitemapEntry[] {
  return SUPPORTED_LOCALES.flatMap((locale) =>
    PUBLIC_PATHS.map((path) => ({
      url: evoliiaUrl(base, locale, path),
      lastModified: now,
      changeFrequency: path === '' ? ('weekly' as const) : ('monthly' as const),
      // L'accueil d'abord, l'inscription juste après ; le légal existe sans être promu.
      priority: path === '' ? 1 : path === 'inscription' ? 0.8 : 0.3,
      alternates: {
        languages: Object.fromEntries(
          SUPPORTED_LOCALES.map((autre) => [autre, evoliiaUrl(base, autre, path)]),
        ),
      },
    })),
  )
}

/**
 * Le plan du site d'une application publiée : ses pages publiques, à son adresse
 * canonique — le sous-domaine quand il existe, l'ancienne adresse sinon. Déclarer les
 * deux ferait passer l'application pour deux sites jumeaux.
 */
export function appSitemap(spec: AppSpec, slug: string, updatedAt: Date): SitemapEntry[] {
  const base = publicAppUrl(slug)
  return spec.pages
    .filter(isIndexable)
    .map((page) => ({
      url: joinUrl(base, page.path),
      lastModified: updatedAt,
      changeFrequency: 'weekly' as const,
      priority: page.path === HOME_PATH ? 1 : 0.6,
    }))
}

/** Le fichier `robots.txt` d'une application : ses pages privées restent hors index. */
export function appRobots(spec: AppSpec, slug: string): string {
  const base = publicAppUrl(slug)
  const interdits = spec.pages.filter((page) => !isIndexable(page)).map((page) => `/${page.path}`)
  return [
    'User-agent: *',
    'Allow: /',
    // Deux raisons d'écarter une page, et une seule conséquence. Réservée, elle ne
    // montrerait qu'un formulaire de connexion, et se ferait indexer sous ce titre. Mise
    // hors index par son créateur, elle est publique mais n'a rien à répondre à personne.
    ...interdits.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${joinUrl(base, 'sitemap.xml')}`,
    // Le plan de site dit où aller ; celui-ci dit de quoi il s'agit. Les moteurs qui
    // l'ignorent ne perdent rien, ceux qui le lisent n'ont plus à deviner.
    `Llms: ${joinUrl(base, 'llms.txt')}`,
    '',
  ].join('\n')
}

/** Rend un plan de site au format XML, pour les réponses servies à la main. */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${escapeXml(entry.url)}</loc>`,
        entry.lastModified === undefined
          ? null
          : `    <lastmod>${entry.lastModified.toISOString()}</lastmod>`,
        entry.changeFrequency === undefined
          ? null
          : `    <changefreq>${entry.changeFrequency}</changefreq>`,
        entry.priority === undefined ? null : `    <priority>${entry.priority}</priority>`,
        '  </url>',
      ]
        .filter((ligne) => ligne !== null)
        .join('\n'),
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Les adresses viennent du nom court et de la spécification : on les échappe quand même. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
