import { requireUser } from '@/server/auth/session'
import { getProject } from '@/server/projects/service'
import { exportOwnerRecords } from '@/server/runtime/records'
import { fail } from '@/server/http/respond'

/**
 * Les fiches d'un modèle, en CSV.
 *
 * Un lien ordinaire plutôt qu'un bouton avec du JavaScript : le navigateur sait déjà
 * enregistrer un fichier, et un tableur s'ouvre là où les données servent vraiment.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; modelId: string }> },
) {
  try {
    const user = await requireUser()
    const { id, modelId } = await context.params
    const project = await getProject(user.id, id)
    const fichier = await exportOwnerRecords({
      userId: user.id,
      projectId: id,
      spec: project.spec,
      modelId,
    })
    return new Response(fichier.content, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${fichier.filename}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return fail(error)
  }
}
