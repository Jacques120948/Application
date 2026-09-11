import { requireUser } from '@/server/auth/session'
import { analyseIdea, ideaInput } from '@/server/projects/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Étape 2 : proposer un plan avant de construire quoi que ce soit. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = ideaInput.parse(await readJson(request))
    return ok(await analyseIdea(user.id, input))
  } catch (error) {
    return fail(error)
  }
}
