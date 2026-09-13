import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import {
  createMonth,
  createVariations,
  monthInput,
  variationInput,
} from '@/server/marketing/atelier'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 120

/**
 * Retravailler une publication, ou prolonger la semaine en mois.
 *
 * Une seule route pour les deux : elles partagent le kit, les droits et la comptabilité, et
 * ne diffèrent que par ce qu'on demande au moteur. Le champ `action` tranche, et le schéma
 * de chaque branche refuse ce qui ne lui appartient pas.
 */
const input = z.discriminatedUnion('action', [
  variationInput.extend({ action: z.literal('variations') }),
  monthInput.extend({ action: z.literal('mois') }),
])

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))

    return ok(
      body.action === 'variations'
        ? await createVariations(user.id, body)
        : await createMonth(user.id, body),
    )
  } catch (error) {
    return fail(error)
  }
}
