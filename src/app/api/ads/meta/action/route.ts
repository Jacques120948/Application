import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { appliquerActionMeta, restaurerActionMeta } from '@/server/ads/envoi-meta'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les deux seules adresses par lesquelles une modification part chez Meta.
 *
 * Rien d'autre du produit n'écrit chez Meta : ni la tournée nocturne, ni la lecture des
 * campagnes, ni le moteur de règles. Une écriture ne peut donc naître que d'une requête,
 * c'est-à-dire d'un clic — et c'est la propriété qu'il faut pouvoir affirmer sans lire tout
 * le code.
 *
 * Les identifiants viennent du navigateur et n'ouvrent rien : ni le constat ni la
 * modification ne sont cherchés ailleurs que parmi ceux de cette personne, sur le compte
 * qu'elle suit. Ce qui arrive du navigateur désigne, il n'autorise pas.
 *
 * Gratuit en crédits : aucun modèle n'intervient. Le coût est ailleurs, et il est réel — la
 * dépense publicitaire de quelqu'un. D'où la limite de fréquence, qui n'est pas là pour
 * protéger un quota mais pour qu'un double clic ne parte pas deux fois.
 */
export const maxDuration = 60

const input = z.discriminatedUnion('geste', [
  z.object({ geste: z.literal('appliquer'), recommandationId: z.string().uuid() }),
  z.object({ geste: z.literal('restaurer'), actionId: z.string().uuid() }),
])

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:meta:ecriture:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))
    const issue =
      demande.geste === 'appliquer'
        ? await appliquerActionMeta(user.id, demande.recommandationId)
        : await restaurerActionMeta(user.id, demande.actionId)

    return ok(issue.ok ? { ok: true, resume: issue.resume } : { ok: false, raison: issue.raison })
  } catch (error) {
    return fail(error)
  }
}
