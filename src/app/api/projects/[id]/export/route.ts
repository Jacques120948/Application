import { requireUser } from '@/server/auth/session'
import { exportProject } from '@/server/export/service'
import { fail } from '@/server/http/respond'

export const maxDuration = 60

/**
 * Télécharge un projet sous forme d'archive.
 *
 * En GET et non en POST : c'est une lecture, le navigateur doit pouvoir l'ouvrir depuis un
 * simple lien, et rien n'est modifié côté serveur. Il n'y a donc pas de vérification
 * d'origine à faire — il n'y a aucune écriture à protéger, et l'archive ne contient que ce
 * que la personne connectée possède déjà.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser()
    const { id } = await params
    const result = await exportProject(user.id, id)

    return new Response(new Uint8Array(result.archive), {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(result.bytes),
        'content-disposition': `attachment; filename="${result.filename}"`,
        // Une archive porte les données du créateur : elle ne doit être gardée nulle part.
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    return fail(error)
  }
}
