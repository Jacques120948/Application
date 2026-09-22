import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { changerMode, MODES } from '@/server/ads/actions'
import { PLATEFORMES_ADS } from '@/server/ads/provider'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Ce que l'agent a le droit de faire sur le compte suivi.
 *
 * Deux valeurs, et « autopilote » n'en est pas une : rien ne l'exécute, et proposer un
 * réglage sans effet serait pire qu'un refus — on croirait ensuite que le produit agit seul.
 *
 * La plateforme est là parce qu'un mode appartient à un compte : sans elle, le bouton de
 * l'écran de MIRA changeait le mode du compte Google, et il ne se passait rien chez Meta.
 */
const input = z.object({
  mode: z.enum(MODES),
  plateforme: z.enum(PLATEFORMES_ADS).default('google-ads'),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:mode:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')
    const demande = input.parse(await readJson(request))
    return ok({ compte: await changerMode(user.id, demande.mode, demande.plateforme) })
  } catch (error) {
    return fail(error)
  }
}
