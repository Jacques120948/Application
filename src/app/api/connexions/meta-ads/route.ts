import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertConnectionSlot } from '@/server/integrations/service'
import { creerEtat } from '@/server/integrations/oauth'
import { metaAds } from '@/server/ads/meta-ads'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Commence l'autorisation Meta : renvoie l'adresse où envoyer la personne.
 *
 * Même forme que Google Ads, et pour les mêmes raisons : la place dans l'offre est vérifiée
 * avant l'écran de consentement — la vérifier au retour reviendrait à faire traverser à
 * quelqu'un l'autorisation de Meta pour lui annoncer ensuite que son offre ne le permet pas.
 * Sans identifiants d'application configurés, la route répond « introuvable » : une porte
 * fermée ne s'annonce pas.
 */
export async function POST(request: Request) {
  if (!metaAds.estConfigure()) return new Response(null, { status: 404 })
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`oauth:${user.id}`, RULES.aiOperation)
    await assertConnectionSlot(user.id, metaAds.id)
    return ok({ url: metaAds.urlAutorisation(creerEtat(user.id, metaAds.id)) })
  } catch (error) {
    return fail(error)
  }
}
