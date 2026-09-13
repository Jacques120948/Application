import { requireUser } from '@/server/auth/session'
import { setOpportunityStatus, statusInput } from '@/server/radar/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Enregistrer, rejeter, archiver, remettre en vue. Aucun appel au modèle. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = statusInput.parse(await readJson(request))
    return ok({ opportunity: await setOpportunityStatus(user.id, body) })
  } catch (error) {
    return fail(error)
  }
}
