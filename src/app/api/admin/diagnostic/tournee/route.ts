import { requireAdmin } from '@/server/admin/service'
import { tournerQuotidien } from '@/server/audit/automatisation'
import { isEnabled } from '@/server/settings/flags'
import { assertSameOrigin, fail, ok } from '@/server/http/respond'

/**
 * Sonde : la tournée quotidienne, tout de suite et sans dépenser.
 *
 * Elle existe à cause d'une panne précise. La surveillance hebdomadaire a tourné des
 * semaines en répondant « passée » sans rien surveiller : elle lisait une table cloisonnée
 * hors de toute portée, ce qui ne lève pas d'erreur et rend zéro ligne. Personne ne
 * pouvait le voir sans attendre le lundi suivant, puis le lundi d'après.
 *
 * Cette route donne la réponse maintenant. Elle fait tout ce que fait la nuit — trouver
 * les sites, interroger Google, relever les chiffres — sauf écrire : elle dit combien de
 * sites auraient écrit un article, et n'en écrit aucun. Aucun crédit ne part, donc on peut
 * l'appeler deux fois pour comparer.
 *
 * Réservée à l'administration, et bornée à cinq sites : c'est une vérification, pas un
 * second planificateur.
 */
export async function GET(request: Request) {
  try {
    assertSameOrigin(request)
    await requireAdmin()

    if (!(await isEnabled('automatisation'))) {
      return ok({ drapeau: 'éteint', message: 'La tournée quotidienne n’est pas autorisée.' })
    }
    return ok({ drapeau: 'allumé', blanc: true, bilan: await tournerQuotidien(5, true) })
  } catch (error) {
    return fail(error)
  }
}
