import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { getProject } from '@/server/projects/service'
import { deleteOwnerRecord, updateOwnerRecord } from '@/server/runtime/records'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Une fiche collectée par l'application, corrigée ou écartée par son créateur.
 *
 * La saisie est revalidée contre le modèle publié, comme partout ailleurs : le navigateur
 * ne décide jamais de la forme des données, même quand c'est le créateur qui saisit.
 */

const updateInput = z.object({ data: z.record(z.string(), z.unknown()) })

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; modelId: string; recordId: string }> },
) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id, modelId, recordId } = await context.params
    const project = await getProject(user.id, id)
    const body = updateInput.parse(await readJson(request))

    return ok({
      record: await updateOwnerRecord({
        userId: user.id,
        projectId: id,
        spec: project.spec,
        modelId,
        recordId,
        input: body.data,
      }),
    })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; modelId: string; recordId: string }> },
) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id, modelId, recordId } = await context.params
    await getProject(user.id, id)
    await deleteOwnerRecord({ userId: user.id, projectId: id, modelId, recordId })
    return ok({ done: true })
  } catch (error) {
    return fail(error)
  }
}
