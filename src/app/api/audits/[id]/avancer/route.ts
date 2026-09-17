import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { advanceAudit } from '@/server/audit/service'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Fait avancer un audit d'une tranche.
 *
 * L'écran appelle en boucle tant que la réponse dit qu'il reste du travail. Chaque appel est
 * indépendant : si l'un échoue, rien n'est perdu, il suffit de rappeler. C'est ce qui permet
 * d'analyser cinquante pages sans jamais tenir une requête plus de vingt secondes.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`audit-pas:${user.id}`, RULES.auditStep)
    const { id } = await context.params
    return ok(await advanceAudit(user.id, id))
  } catch (error) {
    return fail(error)
  }
}
