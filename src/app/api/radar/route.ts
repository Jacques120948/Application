import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { getRadarOverview, runRadar } from '@/server/radar/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

export const maxDuration = 90

const input = z.object({ locale: z.enum(SUPPORTED_LOCALES).default('fr') })

/**
 * Le Radar d'opportunités.
 *
 * GET relit ce qui existe, sans jamais appeler le modèle : afficher la page ne coûte rien.
 * POST lance une recherche — droits, quota, solde, puis appel — et c'est la seule action
 * payante de ce module en dehors de la comparaison.
 */
export async function GET() {
  try {
    const user = await requireUser()
    return ok(await getRadarOverview(user.id))
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const body = input.parse(await readJson(request))
    return ok(await runRadar(user.id, body.locale, 'manual'))
  } catch (error) {
    return fail(error)
  }
}
