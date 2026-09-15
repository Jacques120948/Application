import { z } from 'zod'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import { createRecord, listRecords, RECORD_SORTS, type RecordSort } from '@/server/runtime/records'
import { getEndUser } from '@/server/runtime/end-users'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

/**
 * API de données d'une application générée.
 *
 * Le client n'indique jamais la forme des données : il envoie un identifiant de modèle et
 * des valeurs, le serveur relit la spécification de référence et valide tout.
 */

const createInput = z.object({
  modelId: z.string().min(1).max(48),
  data: z.record(z.string(), z.unknown()),
})

/** Un entier positif lu dans l'adresse, ou rien : une valeur illisible n'est pas une erreur. */
function entier(valeur: string | null): number | undefined {
  if (valeur === null) return undefined
  const nombre = Number(valeur)
  return Number.isInteger(nombre) && nombre >= 0 ? nombre : undefined
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params
    const runtime = await resolveRuntimeSpec(projectId)
    const params = new URL(request.url).searchParams
    const modelId = params.get('modelId') ?? ''
    const endUser = await getEndUser(runtime.projectId)

    // Les critères arrivent de l'adresse : ils sont lus sans confiance. Le service revérifie
    // que chaque nom de champ existe bien dans le modèle publié.
    const sortDemande = params.get('sort')
    const page = await listRecords({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId,
      endUserId: endUser?.id ?? null,
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
    })
    return ok(page)
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`app-write:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.appWrite)

    const runtime = await resolveRuntimeSpec(projectId)
    const body = createInput.parse(await readJson(request))
    const endUser = await getEndUser(runtime.projectId)

    const record = await createRecord({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId: body.modelId,
      endUserId: endUser?.id ?? null,
      input: body.data,
    })
    return ok({ record }, 201)
  } catch (error) {
    return fail(error)
  }
}
