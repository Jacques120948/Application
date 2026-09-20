import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { blogsDisponibles } from '@/server/commerce/publication'
import { fail, ok } from '@/server/http/respond'

/**
 * Les blogs de la boutique, pour choisir où déposer.
 *
 * En lecture, et bornée en fréquence : chaque appel frappe un jeton chez Shopify puis
 * interroge la boutique. L'écran ne la demande qu'à l'ouverture d'un article non déposé,
 * et jamais avant — personne ne doit payer une seconde d'attente pour une liste qu'il ne
 * regardera pas.
 */
export const maxDuration = 30

export async function GET() {
  try {
    const user = await requireUser()
    consume(`shopify:blogs:${user.id}`, RULES.aiOperation)
    return ok({ blogs: await blogsDisponibles(user.id) })
  } catch (error) {
    return fail(error)
  }
}
