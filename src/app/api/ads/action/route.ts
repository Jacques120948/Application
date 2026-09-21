import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { appliquerBudget, appliquerStatut, restaurer } from '@/server/ads/actions'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * La seule route qui puisse modifier une campagne Google Ads.
 *
 * Elle ne décide rien : tout ce qu'elle fait, c'est valider la forme de ce qui arrive et le
 * passer à `actions.ts`, qui écrit le journal avant d'envoyer. Les garde-fous, le mode du
 * compte et l'interrupteur d'exploitation sont vérifiés là-bas, pas ici — une règle qui
 * vivrait dans une route HTTP serait absente de tous les autres chemins.
 *
 * `attenduMicros` et `attendu` ne sont pas des redites : c'est ce que le navigateur croit
 * être la valeur actuelle. Le serveur refuse si elle a changé entre l'affichage et le clic.
 * Sans cela, une recommandation calculée sur un budget de 15 pourrait s'appliquer à un
 * budget passé à 40 entre-temps, et personne n'aurait demandé ce geste-là.
 *
 * Aucun crédit n'est débité : ce n'est pas un appel à un modèle, c'est une écriture chez
 * Google, et elle est déjà bornée en nombre par jour.
 */
const input = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('budget'),
    campagneId: z.string().uuid(),
    versMicros: z.number().int().positive().max(10_000_000_000),
    attenduMicros: z.number().int().nonnegative(),
    recommandationId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal('statut'),
    campagneId: z.string().uuid(),
    vers: z.enum(['ENABLED', 'PAUSED']),
    attendu: z.string().max(40),
    recommandationId: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal('restaurer'), actionId: z.string().uuid() }),
])

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:action:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))
    const issue =
      demande.type === 'budget'
        ? await appliquerBudget(user.id, demande)
        : demande.type === 'statut'
          ? await appliquerStatut(user.id, demande)
          : await restaurer(user.id, demande.actionId)

    /*
     * Un refus de Google ou d'un garde-fou n'est pas une erreur HTTP : c'est une réponse. La
     * distinction compte, parce qu'un 500 ferait croire à une panne là où le produit a
     * simplement dit non — et la phrase qui explique pourquoi doit arriver à l'écran.
     */
    if (!issue.ok) return ok({ ok: false, raison: issue.raison })
    return ok({ ok: true, action: issue.action })
  } catch (error) {
    return fail(error)
  }
}
