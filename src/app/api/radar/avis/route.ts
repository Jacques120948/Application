import { requireUser } from '@/server/auth/session'
import { feedbackInput, recordFeedback } from '@/server/radar/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** « Ça m'intéresse » ou « pas pour moi », avec une raison facultative. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = feedbackInput.parse(await readJson(request))
    await recordFeedback(user.id, body)
    return ok({ recorded: true })
  } catch (error) {
    return fail(error)
  }
}
