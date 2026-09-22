import { requireAdmin } from '@/server/admin/service'
import { recompterConnecteurs } from '@/server/admin/compteurs'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Recompte l'état des connecteurs maintenant, sans attendre la nuit.
 *
 * Le recomptage passe chez chaque utilisateur, un par un : c'est le prix de ne pas
 * contourner le cloisonnement, et il grandit avec le nombre de comptes. D'où le geste
 * explicite plutôt qu'un calcul à l'affichage — une page d'administration qu'on ouvre ne
 * doit pas déclencher une traversée de toute la base.
 */
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await requireAdmin()
    return ok({ ok: true, compteurs: await recompterConnecteurs() })
  } catch (error) {
    return fail(error)
  }
}
