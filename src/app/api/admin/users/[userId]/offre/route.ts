import { setPlanInput, setUserPlan } from '@/server/admin/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export async function PUT(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOrigin(request)
    const { userId } = await context.params
    const { planId } = setPlanInput.parse(await readJson(request))
    await setUserPlan(userId, planId)
    return ok({ done: true })
  } catch (error) {
    return fail(error)
  }
}
