import { requireUser } from '@/server/auth/session'
import { getProject } from '@/server/projects/service'
import { listOwnerRecords, RECORD_SORTS, type RecordSort } from '@/server/runtime/records'
import { fail, ok } from '@/server/http/respond'

/**
 * Les fiches d'un modèle, vues par le créateur de l'application.
 *
 * Mêmes critères que la liste publique — recherche, filtre, ordre, pagination, total — mais
 * sans restriction de personne : le créateur répond des données de son application, et il
 * doit pouvoir les voir toutes pour agir dessus.
 */

function entier(valeur: string | null): number | undefined {
  if (valeur === null) return undefined
  const nombre = Number(valeur)
  return Number.isInteger(nombre) && nombre >= 0 ? nombre : undefined
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; modelId: string }> },
) {
  try {
    const user = await requireUser()
    const { id, modelId } = await context.params
    const project = await getProject(user.id, id)
    const params = new URL(request.url).searchParams
    const sortDemande = params.get('sort')

    return ok(
      await listOwnerRecords({
        userId: user.id,
        projectId: id,
        spec: project.spec,
        modelId,
        query: {
          ...(params.get('recherche') !== null ? { search: params.get('recherche') as string } : {}),
          ...(params.get('champ') !== null ? { filterField: params.get('champ') as string } : {}),
          ...(params.get('valeur') !== null ? { filterValue: params.get('valeur') as string } : {}),
          ...(sortDemande !== null && (RECORD_SORTS as readonly string[]).includes(sortDemande)
            ? { sort: sortDemande as RecordSort }
            : {}),
          ...(params.get('champTri') !== null ? { sortField: params.get('champTri') as string } : {}),
          ...(entier(params.get('limite')) !== undefined
            ? { limit: entier(params.get('limite')) as number }
            : {}),
          ...(entier(params.get('depuis')) !== undefined
            ? { offset: entier(params.get('depuis')) as number }
            : {}),
        },
      }),
    )
  } catch (error) {
    return fail(error)
  }
}
