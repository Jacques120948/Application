import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { synchroniserCompteMeta } from '@/server/ads/synchro-meta'
import { evaluerCompteMeta } from '@/server/ads/recommandations-meta'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Lit les campagnes Meta maintenant, sans attendre la nuit.
 *
 * Gratuite : six lectures chez Meta, aucun crédit, aucun appel à un modèle. Mais elles
 * consomment un plafond partagé par tous les comptes reliés à Evoliia, d'où la limite de
 * fréquence — quelqu'un qui recharge son écran dix fois de suite ne doit pas puiser dans la
 * journée de tout le monde.
 *
 * La première lecture remonte quatre-vingt-dix jours et peut prendre une minute.
 */
/*
 * Soixante secondes : c'est le plafond de l'hébergement, et déclarer au-delà ne le repousse
 * pas — la requête est coupée et rend un 504 sans rien dire.
 */
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:meta:synchro:${user.id}`, RULES.aiOperation)
    /*
     * Le droit de l'agent publicitaire, et non celui de MIRA : sa fiche est encore
     * « prévue » tant qu'elle ne sait rien montrer, et verrouiller sur un droit que
     * personne ne possède fermerait la lecture à celui-là même qui vient de relier son
     * compte. Le verrou se déplacera quand MIRA aura son tableau de bord.
     */
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const issue = await synchroniserCompteMeta(user.id)
    /*
     * Les règles repassent dans la foulée, sinon l'écran s'ouvrirait sur les constats
     * d'avant la lecture — ou sur aucun, la toute première fois. Gratuit : des comparaisons
     * de nombres sur ce qui vient d'être écrit. Et sans conséquence si cela échoue : la
     * lecture, elle, a bien eu lieu, et c'est ce que la personne a demandé.
     */
    if (issue.ok) await evaluerCompteMeta(user.id).catch(() => null)
    return ok(issue.ok ? { ok: true, bilan: issue.bilan } : { ok: false, raison: issue.raison })
  } catch (error) {
    return fail(error)
  }
}
