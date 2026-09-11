import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { requireUser } from '@/server/auth/session'
import { isAiAvailable } from '@/server/ai/client'
import { suggestIdeas } from '@/server/ai/operations'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Assistant « trouver une idée » (exigence 22). */
const input = z.object({
  goal: z.string().min(1).max(120),
  skills: z.string().max(300).default(''),
  sector: z.string().max(200).default(''),
  budget: z.string().max(120).default(''),
  time: z.string().max(120).default(''),
  country: z.string().max(120).default(''),
  audience: z.string().max(200).default(''),
  locale: z.string().max(5).default('fr'),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))

    if (!isAiAvailable()) {
      throw new AppError(
        'AI_UNAVAILABLE',
        "La recherche d'idées a besoin de l'assistant, qui n'est pas configuré sur cette installation. Vous pouvez décrire vous-même votre idée.",
      )
    }

    const { locale, ...profile } = body
    const result = await suggestIdeas(user.id, profile, locale)
    return ok({ ideas: result.value.ideas, creditsSpent: result.creditsSpent })
  } catch (error) {
    return fail(error)
  }
}
