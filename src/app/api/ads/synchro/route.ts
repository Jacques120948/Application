import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { synchroniserCompte } from '@/server/ads/synchro'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Lit les campagnes maintenant, sans attendre la nuit.
 *
 * Gratuite : ce sont deux lectures chez Google, aucun crédit, aucun appel à un modèle. Mais
 * elles consomment un plafond partagé par tous les comptes reliés à Evoliia, d'où la limite
 * de fréquence — quelqu'un qui recharge son écran dix fois de suite ne doit pas puiser dans
 * la journée de tout le monde.
 *
 * La première lecture remonte quatre-vingt-dix jours et peut prendre une minute.
 */
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:synchro:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const issue = await synchroniserCompte(user.id)
    if (!issue.ok) return ok({ ok: false, raison: issue.raison })
    return ok({ ok: true, bilan: issue.bilan })
  } catch (error) {
    return fail(error)
  }
}
