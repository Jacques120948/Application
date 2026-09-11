import { planUpdateInput, updatePlan } from '@/server/admin/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export async function PUT(request: Request, context: { params: Promise<{ planId: string }> }) {
  try {
    assertSameOrigin(request)
    const { planId } = await context.params
    const input = planUpdateInput.parse(await readJson(request))
    return ok({ plan: await updatePlan(planId, input) })
  } catch (error) {
    return fail(error)
  }
}
