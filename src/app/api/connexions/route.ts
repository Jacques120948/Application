import { disconnect, disconnectInput } from '@/server/integrations/service'
import { requireUser } from '@/server/auth/session'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { connectionId } = disconnectInput.parse(await readJson(request))
    await disconnect(user.id, connectionId)
    return ok({ disconnected: true })
  } catch (error) {
    return fail(error)
  }
}
