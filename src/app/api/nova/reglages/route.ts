import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { enregistrerReglages, reglagesSchema } from '@/server/nova/reglages'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Le type d'activité, les objectifs et les coûts que la personne confie à Nova.
 *
 * Validés ici, champ par champ : un pourcentage au-delà de cent ou un montant négatif ne
 * produirait pas une marge fausse, il produirait une marge absurde qu'on croirait juste.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'nova_agent')
    consume(`nova-reglages:${user.id}`, RULES.aiOperation)
    const reglages = await enregistrerReglages(user.id, reglagesSchema.parse(await readJson(request)))
    return ok({ reglages })
  } catch (error) {
    return fail(error)
  }
}
