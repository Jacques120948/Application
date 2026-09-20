import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { deposerDansShopify } from '@/server/commerce/publication'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Dépose un article rédigé dans le blog Shopify, en brouillon.
 *
 * Gratuite : le texte a été payé quand il a été écrit, l'envoyer est un appel d'API sans
 * frais. La limite de fréquence n'est donc pas là pour la dépense mais pour la boutique —
 * une rafale de clics ne doit pas y déposer dix brouillons.
 */
export const maxDuration = 60

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`shopify:depot:${user.id}`, RULES.aiOperation)
    const { id } = await context.params
    return ok(await deposerDansShopify(user.id, id))
  } catch (error) {
    return fail(error)
  }
}
