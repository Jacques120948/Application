import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertConnectionSlot } from '@/server/integrations/service'
import { creerEtat } from '@/server/integrations/oauth'
import { estConfigure, urlAutorisation } from '@/server/integrations/providers/google-search-console'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Commence l'autorisation Google : renvoie l'adresse où envoyer la personne.
 *
 * La place dans l'offre est vérifiée ici, avant de l'envoyer chez Google. La vérifier au
 * retour reviendrait à lui faire traverser un écran de consentement pour lui annoncer
 * ensuite que son offre ne le permet pas.
 *
 * Sans identifiants d'application configurés, la route répond « introuvable » : une porte
 * fermée ne s'annonce pas.
 */
export async function POST(request: Request) {
  if (!estConfigure()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`oauth:${user.id}`, RULES.aiOperation)
    await assertConnectionSlot(user.id, 'google-search-console')
    return ok({ url: urlAutorisation(creerEtat(user.id, 'google-search-console')) })
  } catch (error) {
    return fail(error)
  }
}
