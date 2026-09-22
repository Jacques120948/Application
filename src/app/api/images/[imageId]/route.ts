import { lireImagePubliee } from '@/server/audit/images-article'

/**
 * Sert une image créée pour un article.
 *
 * Publique, et c'est sa raison d'être : cette image part dans un article que le client
 * copie sur son blog, où elle sera chargée par des visiteurs qui ne sont ni lui ni inscrits.
 * Une image que seul son auteur peut voir n'illustre rien. Le détail de ce que cette
 * ouverture concède — c'est-à-dire rien, vu la forme de la table — est expliqué là où elle
 * est décidée, dans la migration et dans `lireImagePubliee`.
 *
 * Aucune session n'est lue, et aucune ne doit l'être : une route publique qui consulterait
 * un cookie se mettrait à répondre différemment selon le visiteur, ce qu'un cache ne sait
 * pas représenter.
 */

/** Un an. Le contenu d'une adresse ne change jamais : une autre image, une autre adresse. */
const CACHE = 'public, max-age=31536000, immutable'

export async function GET(_request: Request, context: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await context.params
  const image = await lireImagePubliee(imageId)
  if (image === null) return new Response(null, { status: 404 })

  return new Response(image.data, {
    headers: {
      'content-type': image.mime,
      'cache-control': CACHE,
      /*
       * Le navigateur ne devine pas le type : une image mal identifiée qui serait
       * interprétée autrement est la faille classique d'une route qui rend des octets.
       */
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  })
}
