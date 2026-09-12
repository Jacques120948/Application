import { readMedia } from '@/server/media/service'

/**
 * Sert une image d'application.
 *
 * Publique, comme la page qui l'affiche : une application en ligne est consultée par des
 * visiteurs qui n'ont pas de compte. L'adresse contient le projet ET l'image, et le service
 * vérifie que la seconde appartient bien au premier — une spécification qui pointerait vers
 * l'image d'un autre projet ne renvoie rien.
 *
 * Le cache est immuable et d'un an : le contenu d'une image ne change jamais, seul son
 * identifiant change. C'est ce qui évite qu'une application très visitée se traduise par
 * autant d'appels au serveur que de visites.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; mediaId: string }> },
) {
  const { projectId, mediaId } = await context.params
  const variant = new URL(request.url).searchParams.get('format') === 'thumb' ? 'thumb' : 'full'

  const media = await readMedia(projectId, mediaId, variant).catch(() => null)
  if (media === null) return new Response('Image introuvable', { status: 404 })

  return new Response(new Uint8Array(media.bytes), {
    headers: {
      'content-type': media.mime,
      'content-length': String(media.bytes.length),
      'cache-control': 'public, max-age=31536000, immutable',
      // L'image n'a aucune raison d'être interprétée autrement que comme une image.
      'x-content-type-options': 'nosniff',
    },
  })
}
