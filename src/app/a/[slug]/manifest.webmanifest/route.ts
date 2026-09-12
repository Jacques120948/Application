import { getPublishedApp } from '@/server/runtime/published'
import { buildManifest } from '@/server/runtime/pwa'

/** Manifeste d'installation d'une application publiée. */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const app = await getPublishedApp(slug).catch(() => null)
  if (app === null) return new Response('Application introuvable', { status: 404 })

  return Response.json(buildManifest(app.spec, app.slug), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      // Le manifeste change quand le créateur republie : un cache court suffit à éviter
      // qu'on le recalcule à chaque visite, sans figer une ancienne identité pour des jours.
      'cache-control': 'public, max-age=300',
    },
  })
}
