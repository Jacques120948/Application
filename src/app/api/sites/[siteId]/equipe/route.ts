import { resolveLocale } from '@/i18n'
import { requireUser } from '@/server/auth/session'
import { askVisibility, askVisibilityInput, getVisibilityDesk } from '@/server/agents/visibility-service'
import { availableCredits } from '@/server/billing/credits'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les questions posées à l'équipe de visibilité.
 *
 * `GET` rend le bureau : qui est ouvert, et les échanges déjà enregistrés. Aucun appel au
 * modèle, donc aucun crédit — relire une conversation qu'on a déjà payée serait la payer
 * deux fois.
 *
 * `POST` pose une question. Le débit passe par la mécanique commune ; le solde rendu est
 * celui d'après, pour que le compteur du bandeau n'ait pas à être deviné. L'identifiant du
 * site vient de l'adresse, celui de la personne de sa session : le premier n'ouvre rien que
 * la seconde ne possède déjà.
 */
export async function GET(_request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    const user = await requireUser()
    const { siteId } = await context.params
    return ok({ desk: await getVisibilityDesk(user.id, siteId) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { siteId } = await context.params
    const brut = (await readJson(request)) as Record<string, unknown>
    const input = askVisibilityInput.parse({ ...brut, siteId })

    const note = await askVisibility(user.id, input, resolveLocale(String(brut['locale'] ?? 'fr')))
    return ok({ note, balance: await availableCredits(user.id) })
  } catch (error) {
    return fail(error)
  }
}
