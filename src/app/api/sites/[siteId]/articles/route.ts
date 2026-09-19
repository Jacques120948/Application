import { z } from 'zod'
import { resolveLocale } from '@/i18n'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { listArticles, redigerArticle } from '@/server/audit/articles'
import { availableCredits } from '@/server/billing/credits'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les articles d'un site.
 *
 * `GET` relit la liste : gratuit, autant de fois qu'on veut. Un texte payé une fois ne se
 * repaie pas parce qu'on a rechargé la page.
 *
 * `POST` fait écrire un article, et c'est la plus grosse dépense du produit. Le débit est
 * fait par la mécanique de crédits commune — réservation avant l'appel, débit sur les jetons
 * réellement consommés — et le solde qui repart vers l'écran est celui d'après, pour que le
 * compteur du bandeau n'ait pas à être deviné.
 *
 * Le débit accordé est celui des opérations IA : un article coûte quinze à trente crédits, et
 * une rafale doit être coupée avant d'être facturée.
 */
/**
 * Le temps que l'hébergeur doit accorder à cette route.
 *
 * Écrire un article, c'est un appel à un modèle qui rend plusieurs milliers de signes, et
 * facultativement une lecture des chiffres de recherche avant lui. Sans ce réglage, la
 * plateforme coupe à quelques secondes par défaut : les crédits seraient réservés, l'appel
 * partirait, et la personne verrait une erreur sur un article qu'elle a payé.
 */
export const maxDuration = 120

const input = z.object({
  demande: z.string().max(400).optional(),
  locale: z.string().max(10).optional(),
})

export async function GET(_request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    const user = await requireUser()
    const { siteId } = await context.params
    return ok({ articles: await listArticles(user.id, siteId) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`articles:${user.id}`, RULES.aiOperation)
    const { siteId } = await context.params
    const body = input.parse(await readJson(request))

    const article = await redigerArticle(
      user.id,
      siteId,
      body.demande ?? '',
      resolveLocale(body.locale ?? 'fr'),
    )
    return ok({ article, balance: await availableCredits(user.id) })
  } catch (error) {
    return fail(error)
  }
}
