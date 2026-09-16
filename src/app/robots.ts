import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'
import { PRIVATE_PATHS } from '@/server/seo/sitemap'

/**
 * `robots.txt` d'Evoliia.
 *
 * L'atelier et le tableau de bord redirigent déjà vers la connexion, mais le dire
 * explicitement évite qu'un robot dépense son budget d'exploration sur des redirections.
 * L'aperçu, lui, doit rester dehors quoi qu'il arrive : c'est le brouillon d'un créateur,
 * et un brouillon indexé serait publié sans que personne l'ait décidé.
 */
export default function robots(): MetadataRoute.Robots {
  const base = env.appUrl.replace(/\/$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/preview/',
        // Le segment de langue est variable : un motif par chemin privé.
        ...PRIVATE_PATHS.map((path) => `/*/${path}`),
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
