import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { ecarterProposition, redigerPourGroupe } from '@/server/ads/redaction'
import { readDashboard } from '@/server/audit/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Faire écrire Naya, ou écarter ce qu'elle a écrit.
 *
 * L'écriture coûte des crédits — c'est un appel à un modèle — et la comptabilité est faite
 * en amont : réservation avant l'appel, débit au coût constaté, libération si le modèle
 * échoue. Rien n'est envoyé à Google : ce qui sort d'ici vit en base d'Evoliia jusqu'à ce
 * qu'une personne décide de le déposer.
 *
 * L'identifiant du contenant vient du navigateur et n'ouvre rien : il n'est cherché que
 * parmi les contenants du compte suivi de cette personne.
 */
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rediger'), groupeId: z.string().uuid() }),
  z.object({ action: z.literal('ecarter'), id: z.string().uuid() }),
])

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:redaction:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))
    if (demande.action === 'ecarter') {
      await ecarterProposition(user.id, demande.id)
      return ok({ ok: true })
    }

    /*
     * Le site sert à lire ce que les gens tapent réellement. Son absence n'empêche pas
     * d'écrire : la rédaction se fait alors sur les produits et l'activité, ce qui est
     * moins bon mais reste utile — et faire échouer une rédaction parce qu'une source
     * d'appoint manque serait indéfendable.
     */
    const site = await readDashboard(user.id).catch(() => null)
    const origin = site === null ? null : `https://${site.site.host}`

    return ok({ ok: true, bilan: await redigerPourGroupe(user.id, demande.groupeId, origin) })
  } catch (error) {
    return fail(error)
  }
}
