import { getPublishedApp } from '@/server/runtime/published'
import { appSitemap, sitemapXml } from '@/server/seo/sitemap'

/**
 * Plan du site d'une application publiée.
 *
 * Il est servi à la main plutôt que par la convention `sitemap.ts` de Next : le nom court
 * vient de l'adresse, et les pages viennent de la spécification publiée, donc rien ne peut
 * être calculé à la compilation.
 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const app = await getPublishedApp(slug).catch(() => null)
  if (app === null) return new Response('Application introuvable', { status: 404 })

  return new Response(sitemapXml(appSitemap(app.spec, app.slug, app.publishedAt)), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Le plan change à chaque publication : un cache court suffit.
      'cache-control': 'public, max-age=3600',
    },
  })
}
