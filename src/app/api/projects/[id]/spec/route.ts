import { requireUser } from '@/server/auth/session'
import { applyManualPatch } from '@/server/projects/service'
import { specPatchSchema } from '@/server/spec/patch'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Éditeur visuel (exigence 7) : même moteur de patch, sans IA et sans crédit. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const patch = specPatchSchema.parse(await readJson(request))
    return ok(await applyManualPatch(user.id, id, patch))
  } catch (error) {
    return fail(error)
  }
}
