import { getPublishedApp } from '@/server/runtime/published'
import { appRobots } from '@/server/seo/sitemap'

/**
 * `robots.txt` d'une application publiée.
 *
 * Sur l'adresse propre de l'application, le routage de bordure amène `/robots.txt` ici :
 * une application servie à la racine de son sous-domaine répond donc avec ses propres
 * règles, et non avec celles d'Evoliia.
 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const app = await getPublishedApp(slug).catch(() => null)
  if (app === null) {
    // Une adresse sans application n'a rien à faire explorer.
    return new Response('User-agent: *\nDisallow: /\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response(appRobots(app.spec, app.slug), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
