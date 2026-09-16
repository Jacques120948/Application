import {
  creditSettingsInput,
  modelPricingInput,
  updateCreditSettings,
  updateModelPricing,
} from '@/server/admin/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Tarifs des modèles et conversion en crédits. Réservé à l'administration.
 *
 * Deux objets distincts sur la même route : un tarif de modèle porte un `model`, un
 * réglage de conversion porte un `multiplier`. La distinction est faite sur la présence
 * du champ plutôt que sur un verbe HTTP, parce que les deux sont des mises à jour.
 */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const body = await readJson(request)
    if (typeof body === 'object' && body !== null && 'model' in body) {
      await updateModelPricing(modelPricingInput.parse(body))
    } else {
      await updateCreditSettings(creditSettingsInput.parse(body))
    }
    return ok({ saved: true })
  } catch (error) {
    return fail(error)
  }
}
