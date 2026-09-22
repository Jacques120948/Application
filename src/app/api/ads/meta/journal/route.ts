import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { journalMetaSuivi } from '@/server/ads/envoi-meta'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les modifications plus anciennes du journal de MIRA.
 *
 * Une adresse à part, et non un geste de plus sur la route d'écriture. Celle-ci affirme dans
 * son propre commentaire qu'elle est « la seule par laquelle une modification part chez
 * Meta » — une propriété qu'on doit pouvoir vérifier sans lire tout le fichier, et qu'une
 * lecture mêlée aux écritures rendrait fausse à l'œil.
 *
 * Rien n'est écrit ici, ni chez Meta ni en base, et aucun crédit n'est consommé : c'est une
 * page de journal. La limite de fréquence reste, parce qu'un journal se pagine en cliquant
 * et qu'un clic répété ne doit pas devenir une suite de comptages.
 *
 * Le compte n'est pas reçu : il est retrouvé à partir de la personne connectée.
 */
const input = z.object({
  /** La date de la dernière ligne déjà reçue. Absente : la première page. */
  avant: z.string().datetime().optional(),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:meta:journal:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')

    const demande = input.parse(await readJson(request))
    const page = await journalMetaSuivi(user.id, {
      ...(demande.avant === undefined ? {} : { avant: new Date(demande.avant) }),
    })

    return ok({
      lignes: page.lignes.map((une) => ({ ...une, createdAt: une.createdAt.toISOString() })),
      total: page.total,
      encore: page.encore,
    })
  } catch (error) {
    return fail(error)
  }
}
