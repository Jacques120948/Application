import { z } from 'zod'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import { deleteRecord } from '@/server/runtime/records'
import { getEndUser } from '@/server/runtime/end-users'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

const input = z.object({ modelId: z.string().min(1).max(48) })

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string; recordId: string }> },
) {
  try {
    assertSameOrigin(request)
    const { projectId, recordId } = await context.params
    const runtime = await resolveRuntimeSpec(projectId)
    const body = input.parse(await readJson(request))
    const endUser = await getEndUser(runtime.projectId)

    await deleteRecord({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId: body.modelId,
      recordId,
      endUserId: endUser?.id ?? null,
    })
    return ok({ done: true })
  } catch (error) {
    return fail(error)
  }
}
