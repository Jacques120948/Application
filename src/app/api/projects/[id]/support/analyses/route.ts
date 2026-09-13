import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { SUPPORTED_LOCALES } from '@/i18n/config'
import { generateInsights, insightUpdate, listInsights, setInsightStatus } from '@/server/support/insights'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

type Context = { params: Promise<{ id: string }> }

export const maxDuration = 90

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ insights: await listInsights(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

/** Analyse à la demande (Lia V2, payant). */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = z.object({ locale: z.enum(SUPPORTED_LOCALES).default('fr') }).parse(await readJson(request))
    return ok(await generateInsights(user.id, id, body.locale))
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const input = insightUpdate.parse(await readJson(request))
    return ok({ insight: await setInsightStatus(user.id, id, input) })
  } catch (error) {
    return fail(error)
  }
}
