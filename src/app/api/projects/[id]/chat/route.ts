import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { editWithAgent, editWithAssistant, listChatMessages } from '@/server/projects/service'
import { isEnabled } from '@/server/settings/flags'
import { MAX_ATTACHMENTS } from '@/server/media/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Modification d'une application en langage courant.
 *
 * Une seule adresse pour les deux chemins : l'interrupteur décide lequel répond, et le
 * navigateur n'a pas à le savoir. C'est ce qui permet de revenir en arrière sans rien
 * déployer — et de comparer les deux sur les mêmes demandes.
 */
const input = z.object({
  message: z.string().min(1).max(2000),
  /**
   * Images jointes à la demande.
   *
   * Seuls des identifiants transitent : les fichiers ont déjà été envoyés et traités par
   * la bibliothèque du projet. Le service les relit et n'en retient que ceux qui
   * appartiennent bien à ce créateur et à ce projet — le navigateur ne fait que désigner.
   */
  mediaIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS).optional(),
})

/**
 * L'agent enchaîne plusieurs appels au modèle : il lui faut davantage que les quelques
 * dizaines de secondes d'un appel unique. Ses propres bornes l'arrêtent bien avant.
 */
export const maxDuration = 300

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ messages: await listChatMessages(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = input.parse(await readJson(request))

    const agent = await isEnabled('appBuilder')
    return ok(
      agent
        ? await editWithAgent(user.id, id, body.message, body.mediaIds ?? [])
        : await editWithAssistant(user.id, id, body.message, body.mediaIds ?? []),
    )
  } catch (error) {
    return fail(error)
  }
}
