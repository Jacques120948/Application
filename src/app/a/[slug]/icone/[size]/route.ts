import sharp from 'sharp'
import { getPublishedApp } from '@/server/runtime/published'
import { iconSvg, isIconSize } from '@/server/runtime/pwa'

/**
 * Icône d'installation, dessinée depuis le thème de l'application.
 *
 * Les tailles acceptées forment une liste fermée : servir n'importe quelle dimension
 * demandée reviendrait à offrir un calcul d'image à qui veut, sur une adresse publique.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; size: string }> },
) {
  const { slug, size } = await context.params
  const wanted = Number.parseInt(size, 10)
  if (!Number.isFinite(wanted) || !isIconSize(wanted)) {
    return new Response('Taille non disponible', { status: 404 })
  }

  const app = await getPublishedApp(slug).catch(() => null)
  if (app === null) return new Response('Application introuvable', { status: 404 })

  const padded = new URL(request.url).searchParams.get('masque') === '1'
  const png = await sharp(Buffer.from(iconSvg(app.spec, wanted, padded))).png().toBuffer()

  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.length),
      'cache-control': 'public, max-age=3600',
    },
  })
}
