import { requireUser } from '@/server/auth/session'
import { resolveLocale } from '@/i18n'
import { ask, askInput } from '@/server/agents/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Une réponse de spécialiste tient en quelques centaines de mots sur le modèle rapide,
 * mais la lecture des faits du projet et l'appel s'additionnent : le plafond laisse de la
 * marge plutôt que de couper la fonction juste avant la réponse.
 */
export const maxDuration = 120

/**
 * Question posée à l'un des trois spécialistes marketing.
 *
 * Le projet vient de l'adresse, pas du corps de la requête : deux sources pour la même
 * information, c'est une occasion de les voir diverger. Le service revérifie de toute façon
 * que le projet appartient bien à la personne connectée.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await params
    const body = (await readJson(request)) as Record<string, unknown>
    const input = askInput.parse({ ...body, projectId: id })
    // L'écran attend la note sous sa clé, pas à la racine : c'est ce qui lui permet de
    // distinguer une réponse d'un message d'erreur.
    return ok({ note: await ask(user.id, input, resolveLocale(user.locale)) })
  } catch (error) {
    return fail(error)
  }
}
