import { z } from 'zod'
import { closeReport } from '@/server/admin/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Marquer un signalement comme traité. La lecture se fait au rendu de la page. */
const input = z.object({ id: z.string().uuid() })

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const { id } = input.parse(await readJson(request))
    await closeReport(id)
    return ok({ handled: true })
  } catch (error) {
    return fail(error)
  }
}
