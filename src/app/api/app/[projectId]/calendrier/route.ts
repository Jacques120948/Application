import { resolveRuntimeSpec } from '@/server/runtime/context'
import { getEndUser } from '@/server/runtime/end-users'
import { listMonth } from '@/server/runtime/records'
import { fail, ok } from '@/server/http/respond'

/**
 * Un mois de fiches, pour la vue calendrier.
 *
 * Le navigateur demande un mois ; le serveur relit la spécification publiée pour savoir
 * quel modèle et quels champs ce bloc utilise. Il ne prend du navigateur que l'identifiant
 * du bloc et le mois : ni le modèle, ni les champs, qui décideraient sinon de ce qu'on a le
 * droit de lire.
 */
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params
    const runtime = await resolveRuntimeSpec(projectId)
    const params = new URL(request.url).searchParams

    const blockId = params.get('bloc') ?? ''
    const bloc = runtime.spec.pages
      .flatMap((page) => page.blocks)
      .find((block) => block.type === 'calendar' && block.id === blockId)
    if (bloc === undefined || bloc.type !== 'calendar') {
      return ok({ entries: [] })
    }

    const endUser = await getEndUser(runtime.projectId)
    const entries = await listMonth({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId: bloc.modelId,
      dateField: bloc.dateField,
      titleField: bloc.titleField,
      colorField: bloc.colorField,
      month: params.get('mois') ?? '',
      endUserId: endUser?.id ?? null,
    })
    return ok({ entries })
  } catch (error) {
    return fail(error)
  }
}
