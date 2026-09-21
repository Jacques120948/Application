import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertConnectionSlot } from '@/server/integrations/service'
import { creerEtat } from '@/server/integrations/oauth'
import { googleAds } from '@/server/ads/google-ads'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Commence l'autorisation Google Ads : renvoie l'adresse où envoyer la personne.
 *
 * Même forme que Search Console, et pour les mêmes raisons : la place dans l'offre est
 * vérifiée avant l'écran de consentement — la vérifier au retour reviendrait à faire
 * traverser à quelqu'un l'autorisation de Google pour lui annoncer ensuite que son offre ne
 * le permet pas. Sans identifiants d'application configurés, la route répond
 * « introuvable » : une porte fermée ne s'annonce pas.
 */
export async function POST(request: Request) {
  if (!googleAds.estConfigure()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`oauth:${user.id}`, RULES.aiOperation)
    await assertConnectionSlot(user.id, googleAds.id)
    return ok({ url: googleAds.urlAutorisation(creerEtat(user.id, googleAds.id)) })
  } catch (error) {
    return fail(error)
  }
}
