import { requireAdmin } from '@/server/admin/service'
import { withUserScope } from '@/server/db/scope'
import { useOAuthAccess } from '@/server/integrations/service'
import {
  inspecterUrl,
  listerProprietes,
  rafraichir,
} from '@/server/integrations/providers/google-search-console'
import { choisirPropriete } from '@/server/audit/recherches'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Sonde : ce que l'API d'inspection d'URL accepte réellement.
 *
 * Elle existe pour répondre à deux questions qu'on ne peut pas trancher de mémoire — la
 * portée OAuth exigée, et le quota appliqué — et elle le fait en le demandant à Google
 * plutôt qu'en le supposant. La réponse est rendue brute, refus compris : une erreur
 * reformulée n'apprend rien, alors que le message de Google dit exactement ce qui manque.
 *
 * Réservée à l'administration, et appelée une fois. Ce n'est pas une fonction du produit :
 * c'est le geste qui décide si la fonction est constructible. Elle a vocation à disparaître
 * une fois la réponse connue.
 */
export async function GET(request: Request) {
  try {
    /*
     * La règle vaut pour toute route d'administration, lecture comprise : une exception
     * demanderait de juger au cas par cas, et c'est le genre de jugement qui se relâche.
     * Elle ne coûte rien ici — une navigation directe n'envoie pas d'en-tête d'origine et
     * passe donc, ce qui permet d'ouvrir cette adresse dans un navigateur.
     */
    assertSameOrigin(request)
    const admin = await requireAdmin()
    const demande = new URL(request.url).searchParams.get('url')

    const acces = await useOAuthAccess(admin.id, 'google-search-console', rafraichir)
    if (!acces.ok) return ok({ etape: 'acces', raison: acces.raison })

    const proprietes = await listerProprietes(acces.accessToken)
    if (!proprietes.ok) return ok({ etape: 'proprietes', raison: proprietes.raison })

    const site = await withUserScope(admin.id, (tx) =>
      tx.site.findFirst({
        where: { userId: admin.id, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { origin: true },
      }),
    )
    if (site === null) return ok({ etape: 'site', raison: 'Aucun site suivi.' })

    const propriete = choisirPropriete(site.origin, proprietes.proprietes)
    if (propriete === null) {
      return ok({
        etape: 'propriete',
        raison: 'Aucune propriété ne correspond à ce site.',
        vues: proprietes.proprietes.map((p) => p.siteUrl),
      })
    }

    const inspection = await inspecterUrl(acces.accessToken, propriete, demande ?? site.origin)

    return ok({
      etape: 'inspection',
      propriete,
      url: demande ?? site.origin,
      status: inspection.status,
      reponse: inspection.corps,
    })
  } catch (error) {
    return fail(error)
  }
}
