import { agentLimitsInput, updateAgentLimits } from '@/server/admin/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Bornes de l'agent de construction. Réservé à l'administration. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    await updateAgentLimits(agentLimitsInput.parse(await readJson(request)))
    return ok({ saved: true })
  } catch (error) {
    return fail(error)
  }
}
