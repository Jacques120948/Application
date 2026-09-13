import { getEndUser } from '@/server/runtime/end-users'
import { visitorHashFor, type Actor } from '@/server/support/conversation'
import { clientIp } from '@/server/http/respond'

/**
 * Qui parle à Lia : un compte de l'application quand il y en a un, sinon une empreinte
 * anonyme. Dans les deux cas, rien qui identifie la personne n'est conservé en clair.
 */
export async function actorFor(request: Request, projectId: string): Promise<Actor> {
  const endUser = await getEndUser(projectId)
  return {
    visitorHash: visitorHashFor(projectId, clientIp(request), request.headers.get('user-agent')),
    endUserId: endUser?.id ?? null,
  }
}
