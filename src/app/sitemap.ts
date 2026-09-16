import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'
import { evoliiaSitemap } from '@/server/seo/sitemap'

/**
 * Plan du site d'Evoliia.
 *
 * Il ne liste que les pages d'Evoliia. Les applications créées ne sont pas des pages
 * d'Evoliia : chacune a son propre plan, à son adresse, et les faire figurer ici
 * reviendrait à publier la liste des créations de tous les clients sans le leur demander.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return evoliiaSitemap(env.appUrl)
}
