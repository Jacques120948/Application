import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { deleteProject, renameProject } from '@/server/projects/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const patchInput = z.object({ name: z.string().trim().min(1).max(60) })

/** Renomme un projet. Le nom change, l'adresse publique non. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const { name } = patchInput.parse(await readJson(request))
    return ok(await renameProject(user.id, { projectId: id, name }))
  } catch (error) {
    return fail(error)
  }
}

/** Supprime un projet et le retire immédiatement du public. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    await deleteProject(user.id, id)
    return ok({ deleted: true })
  } catch (error) {
    return fail(error)
  }
}
