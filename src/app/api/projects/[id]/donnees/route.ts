import { requireUser } from '@/server/auth/session'
import { getProject } from '@/server/projects/service'
import { getOwnerDataOverview } from '@/server/runtime/records'
import { fail, ok } from '@/server/http/respond'

/** Onglet « Utilisateurs » : ce que les visiteurs de l'application ont enregistré. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    const project = await getProject(user.id, id)
    return ok(await getOwnerDataOverview(user.id, id, project.spec))
  } catch (error) {
    return fail(error)
  }
}
