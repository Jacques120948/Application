import { z } from 'zod'
import { resolveLocale } from '@/i18n'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { listCorrections, redigerCorrections } from '@/server/audit/corrections'
import { availableCredits } from '@/server/billing/credits'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les corrections rédigées pour un constat.
 *
 * `GET` relit ce qui a déjà été écrit : gratuit, autant de fois qu'on veut. Un texte payé
 * une fois ne se repaie pas parce qu'on a rechargé la page.
 *
 * `POST` fait travailler le modèle, et c'est la seule dépense du produit de visibilité. Le
 * débit est fait par la mécanique de crédits commune — réservation avant l'appel, débit sur
 * les jetons réellement consommés — et le solde qui repart vers l'écran est celui d'après,
 * pour que le compteur du bandeau n'ait pas à être deviné.
 *
 * Le débit accordé est celui des opérations IA, pas celui d'une simple écriture : rédiger
 * coûte de l'argent à Evoliia, et une rafale doit être coupée avant d'être facturée.
 */
const input = z.object({
  checkId: z.string().min(1).max(120),
  locale: z.string().max(10).optional(),
})

export async function GET(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    const user = await requireUser()
    const { siteId } = await context.params
    const checkId = new URL(request.url).searchParams.get('checkId') ?? ''
    if (checkId === '') return ok({ corrections: [] })
    return ok({ corrections: await listCorrections(user.id, siteId, checkId) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`corrections:${user.id}`, RULES.aiOperation)
    const { siteId } = await context.params
    const body = input.parse(await readJson(request))

    const resultat = await redigerCorrections(
      user.id,
      siteId,
      body.checkId,
      resolveLocale(body.locale ?? 'fr'),
    )
    return ok({ ...resultat, balance: await availableCredits(user.id) })
  } catch (error) {
    return fail(error)
  }
}
