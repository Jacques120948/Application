import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { readDashboard } from '@/server/audit/service'
import { rafraichirVolumes } from '@/server/audit/volumes'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Redemande à Google le volume de recherche des mots du site.
 *
 * Gratuite en argent, coûteuse en quota : le planificateur de mots-clés compte dans les
 * opérations quotidiennes d'Evoliia, et ce quota est partagé par tous ses utilisateurs.
 * D'où le geste explicite plutôt que l'appel automatique à l'affichage — un écran rechargé
 * dix fois ne doit pas coûter dix appels — et la limite de fréquence par personne.
 *
 * Le site n'est pas cru sur parole : `readDashboard` ne le cherche que parmi ceux de la
 * personne, et c'est son origine à lui, jamais celle du navigateur, qui part chez Google.
 */
export const maxDuration = 120

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`volumes:${user.id}`, RULES.aiOperation)

    const { siteId } = await context.params
    const tableau = await readDashboard(user.id, siteId)
    if (tableau === null) return ok({ ok: false, raison: 'Ce site est introuvable.' })

    const issue = await rafraichirVolumes(user.id, tableau.site.id, tableau.site.origin, 'fr')
    return ok(issue)
  } catch (error) {
    return fail(error)
  }
}
