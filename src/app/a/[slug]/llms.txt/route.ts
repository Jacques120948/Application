import { getPublishedApp } from '@/server/runtime/published'
import { appLlmsTxt } from '@/server/seo/visibility'

/**
 * `llms.txt` d'une application publiée.
 *
 * Le pendant du plan de site pour les moteurs génératifs : au lieu d'une liste d'adresses à
 * explorer, une page unique qui dit en clair ce qu'est ce site, qui le tient et ce qu'on y
 * trouve. Une machine n'a alors plus à le déduire de la mise en page.
 *
 * La convention est jeune, et tous les moteurs ne la lisent pas. Elle ne coûte pourtant
 * rien à servir — le contenu existe déjà —, ce qui en fait un pari bon marché plutôt qu'une
 * promesse. Personne, ici ou dans l'interface, ne doit la présenter autrement.
 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const app = await getPublishedApp(slug).catch(() => null)
  if (app === null) return new Response('Application introuvable', { status: 404 })

  return new Response(appLlmsTxt(app.spec, app.slug), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Le contenu change à chaque publication : un cache court suffit.
      'cache-control': 'public, max-age=3600',
    },
  })
}
