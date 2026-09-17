import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { advanceAudit } from '@/server/audit/service'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Le temps que l'hébergeur doit accorder à cet appel.
 *
 * Une tranche vise vingt secondes ; sans ce réglage, la plateforme coupe à dix ou quinze par
 * défaut et la tranche meurt en plein travail. Soixante laisse la marge nécessaire à un site
 * lent sans permettre à un appel de s'éterniser.
 */
export const maxDuration = 60

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
