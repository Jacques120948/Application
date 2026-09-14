import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { getRadarOverview, runRadar } from '@/server/radar/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { SUPPORTED_LOCALES } from '@/i18n/config'

/**
 * Une recherche passe par le modèle de raisonnement et produit plusieurs milliers de
 * mots structurés : elle dépasse souvent 90 secondes. Le plafond suit celui de la
 * recherche automatique (cron), sinon l'hébergeur coupe la fonction avant la réponse et
 * la personne ne voit qu'un délai dépassé, sans opportunité ni explication.
 */
export const maxDuration = 300

const input = z.object({
  locale: z.enum(SUPPORTED_LOCALES).default('fr'),
  /** V2 : chercher autour d'un projet existant. */
  projectId: z.string().uuid().optional(),
})

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
    return ok(
      body.projectId === undefined
        ? await runRadar(user.id, body.locale, 'manual')
        : await runRadar(user.id, body.locale, 'project', { projectId: body.projectId }),
    )
  } catch (error) {
    return fail(error)
  }
}
