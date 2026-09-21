import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { enregistrerProfil, OBJECTIFS } from '@/server/ads/profil'
import { evaluerCompte } from '@/server/ads/recommandations'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Enregistre le profil publicitaire du compte suivi.
 *
 * Les bornes ne sont pas décoratives. Une marge au-dessus de cent pour cent donnerait un
 * seuil de rentabilité inférieur au seuil d'existence, et Evoliia annoncerait une
 * rentabilité à quelqu'un qui perd de l'argent. Une marge négative ferait diviser par un
 * nombre négatif. Un budget démesuré rendrait la projection illisible sans rien empêcher.
 * Chacune de ces valeurs est refusée ici, côté serveur, parce que le navigateur propose mais
 * ne décide pas — et parce qu'une contrainte qui n'existe qu'en HTML n'existe pas.
 *
 * Le compte n'est pas dans la requête : c'est celui que Naya suit. Un identifiant de compte
 * qui voyagerait depuis le navigateur serait une case de plus à vérifier pour rien.
 */
const input = z.object({
  activite: z.string().max(120).default(''),
  pays: z.string().max(60).default(''),
  produits: z.string().max(400).default(''),
  panierMoyen: z.number().min(0).max(1_000_000).default(0),
  margePourcent: z.number().int().min(0).max(100).default(0),
  roasCible: z.number().int().min(0).max(10_000).default(0),
  cpaCible: z.number().min(0).max(1_000_000).default(0),
  budgetMensuel: z.number().min(0).max(10_000_000).default(0),
  objectif: z.enum(OBJECTIFS).default('conversions'),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:profil:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')
    const saisie = input.parse(await readJson(request))
    const { profil } = await enregistrerProfil(user.id, saisie)

    /*
     * Les règles repassent immédiatement. La marge décide de tous les verdicts de
     * rentabilité : attendre la nuit pour en tirer les conséquences laisserait la personne
     * devant un écran qui n'a pas bougé après le seul geste qui change tout.
     */
    await evaluerCompte(user.id).catch(() => null)

    return ok({ profil })
  } catch (error) {
    return fail(error)
  }
}
