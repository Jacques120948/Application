import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { classementSchema, classerResultat, enregistrerResultat, resultatSchema, supprimerResultat } from '@/server/lina/resultats'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les résultats de campagnes, saisis par la personne. Aucun crédit : Lina calcule les taux
 * et compare les variantes par du code.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-resultats:${user.id}`, RULES.appWrite)
    return ok({ resultat: await enregistrerResultat(user.id, resultatSchema.parse(await readJson(request))) })
  } catch (error) {
    return fail(error)
  }
}

const suppression = z.object({ id: z.string().uuid() })

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-resultats:${user.id}`, RULES.appWrite)
    await supprimerResultat(user.id, suppression.parse(await readJson(request)).id)
    return ok({ supprime: true })
  } catch (error) {
    return fail(error)
  }
}

/** Donner un nom de test et une variante à un résultat relu depuis l'outil d'envoi. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    requireFeature(await getEntitlements(user.id), 'lina_agent')
    consume(`lina-resultats:${user.id}`, RULES.appWrite)
    await classerResultat(user.id, classementSchema.parse(await readJson(request)))
    return ok({ classe: true })
  } catch (error) {
    return fail(error)
  }
}
