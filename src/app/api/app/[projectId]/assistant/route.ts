import { assistantInput, askAppAssistant } from '@/server/runtime/assistant'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`assistant:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.appAssistant)
    const input = assistantInput.parse(await readJson(request))
    return ok(await askAppAssistant(projectId, input))
  } catch (error) {
    return fail(error)
  }
}
