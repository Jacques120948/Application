import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { synchroniserCompte } from '@/server/ads/synchro'
import { synchroniserCreatif } from '@/server/ads/creatif'
import { evaluerCompte } from '@/server/ads/recommandations'
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

    /*
     * Le créatif suit, même s'il n'est pas dû. La tournée nocturne ne le relit qu'une fois
     * par semaine parce qu'il ne bouge pas plus vite ; mais quelqu'un qui clique « lire
     * maintenant » vient de changer quelque chose et veut le voir, pas apprendre qu'il
     * faudra attendre mardi.
     */
    await synchroniserCreatif(user.id).catch(() => null)

    /*
     * Les règles enchaînent sur la lecture, et c'est gratuit : aucune requête chez Google,
     * aucun crédit, des comparaisons de nombres sur ce qu'on vient d'écrire. Les séparer
     * obligerait à cliquer deux fois pour une seule question — « et alors ? ».
     */
    await evaluerCompte(user.id).catch(() => null)

    return ok({ ok: true, bilan: issue.bilan })
  } catch (error) {
    return fail(error)
  }
}
