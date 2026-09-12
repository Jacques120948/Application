import {
  connectInput,
  connectWithApiKey,
  disconnect,
  disconnectInput,
} from '@/server/integrations/service'
import { requireUser } from '@/server/auth/session'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Connexion d'un service par clé du créateur.
 *
 * La réponse ne contient jamais la clé envoyée, seulement son indice : ce qui remonte au
 * navigateur est ce que le créateur a déjà sous les yeux.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = connectInput.parse(await readJson(request))
    const connection = await connectWithApiKey(user.id, input)
    return ok({
      connection: {
        id: connection.id,
        providerId: connection.providerId,
        status: connection.status,
        accountLabel: connection.accountLabel,
        connectedAt: connection.connectedAt,
        hint: connection.hint,
      },
    })
  } catch (error) {
    return fail(error)
  }
}

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
