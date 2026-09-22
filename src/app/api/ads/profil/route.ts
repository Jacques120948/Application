import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { requireFeature } from '@/server/billing/features'
import { getEntitlements } from '@/server/billing/entitlements'
import { enregistrerProfil, OBJECTIFS } from '@/server/ads/profil'
import { evaluerCompte } from '@/server/ads/recommandations'
import { evaluerCompteMeta } from '@/server/ads/recommandations-meta'
import { PLATEFORMES_ADS } from '@/server/ads/provider'
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
 * L'identifiant du compte n'est pas dans la requête : c'est celui que l'agent suit sur la
 * plateforme demandée. Un identifiant qui voyagerait depuis le navigateur serait une case de
 * plus à vérifier pour rien ; le nom de la plateforme, lui, ne désigne qu'un catalogue fermé
 * et se vérifie en une comparaison.
 *
 * La plateforme est là parce que les objectifs appartiennent à un compte, pas à une
 * personne. Sans elle, une marge saisie depuis l'écran de MIRA partait sur le compte Google
 * de Naya : le formulaire disait « enregistré », et l'écran continuait d'afficher qu'il
 * manquait des objectifs.
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
  plateforme: z.enum(PLATEFORMES_ADS).default('google-ads'),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`ads:profil:${user.id}`, RULES.aiOperation)
    requireFeature(await getEntitlements(user.id), 'visibility_ads_agent')
    const { plateforme, ...saisie } = input.parse(await readJson(request))
    const { profil } = await enregistrerProfil(user.id, saisie, plateforme)

    /*
     * Les règles repassent immédiatement, et ce sont celles de la plateforme concernée. La
     * marge décide de tous les verdicts de rentabilité : attendre la nuit pour en tirer les
     * conséquences laisserait la personne devant un écran qui n'a pas bougé après le seul
     * geste qui change tout.
     */
    if (plateforme === 'meta-ads') await evaluerCompteMeta(user.id).catch(() => null)
    else await evaluerCompte(user.id).catch(() => null)

    return ok({ profil })
  } catch (error) {
    return fail(error)
  }
}
