import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { useOAuthAccess } from '@/server/integrations/service'
import { googleAds } from './google-ads'
import type { AccesAds } from './provider'

/**
 * Les comptes publicitaires reliés, et celui que Naya suit.
 *
 * Une autorisation Google donne souvent accès à plusieurs comptes : celui de l'entreprise,
 * celui d'une ancienne agence, parfois un compte administrateur qui n'en est pas vraiment
 * un. Les lire tous et en suivre un seul est délibéré.
 *
 * **Un seul compte actif.** Additionner deux comptes donnerait un ROAS moyen qui ne décrit
 * aucune réalité, et proposer un budget sur une moyenne est la meilleure façon de se
 * tromper deux fois. La personne choisit ; Naya ne regarde que celui-là.
 *
 * **Les comptes administrateurs ne sont jamais choisis d'office.** Un compte gestionnaire ne
 * diffuse pas de publicité : il n'a ni dépense ni conversion à montrer. Le désigner par
 * défaut donnerait un tableau de bord vide à quelqu'un qui a des campagnes qui tournent, et
 * la panne serait cherchée partout sauf là.
 *
 * **Rien n'est actif tant qu'il n'y a pas de quoi choisir.** Quand l'autorisation ne donne
 * accès qu'à un seul compte diffusant, il est retenu : demander de choisir dans une liste
 * d'un élément est une question dont la réponse est déjà connue.
 */

export type CompteRelie = {
  id: string
  compteId: string
  nom: string
  devise: string
  fuseau: string
  gestionnaire: boolean
  actif: boolean
  synchroAt: Date | null
}

/** Le compte que Naya suit, ou `null` quand aucun n'est relié. */
export async function compteActif(userId: string): Promise<CompteRelie | null> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsAccount.findFirst({
      where: { userId, plateforme: googleAds.id, actif: true },
      orderBy: { createdAt: 'asc' },
    }),
  )
  return ligne === null ? null : vue(ligne)
}

function vue(ligne: {
  id: string
  compteId: string
  nom: string
  devise: string
  fuseau: string
  gestionnaire: boolean
  actif: boolean
  synchroAt: Date | null
}): CompteRelie {
  return {
    id: ligne.id,
    compteId: ligne.compteId,
    nom: ligne.nom,
    devise: ligne.devise,
    fuseau: ligne.fuseau,
    gestionnaire: ligne.gestionnaire,
    actif: ligne.actif,
    synchroAt: ligne.synchroAt,
  }
}

export async function listerComptesRelies(userId: string): Promise<CompteRelie[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsAccount.findMany({
      where: { userId, plateforme: googleAds.id },
      orderBy: [{ gestionnaire: 'asc' }, { nom: 'asc' }],
    }),
  )
  return lignes.map(vue)
}

/**
 * Enregistre les comptes auxquels l'autorisation donne accès.
 *
 * Appelée une fois, au retour de Google. Les comptes sont réécrits plutôt qu'ajoutés : une
 * personne qui perd l'accès à un compte ne doit pas continuer de le voir proposé, et le
 * choix actif survit tant que le compte existe encore.
 */
export async function enregistrerComptes(
  userId: string,
  accessToken: string,
): Promise<{ ok: true; comptes: CompteRelie[] } | { ok: false; raison: string }> {
  const lecture = await googleAds.listerComptes(accessToken)
  if (!lecture.ok) return lecture

  const dejaActif = await compteActif(userId)

  for (const compte of lecture.valeur) {
    await withUserScope(userId, (tx) =>
      tx.adsAccount.upsert({
        where: {
          userId_plateforme_compteId: {
            userId,
            plateforme: googleAds.id,
            compteId: compte.compteId,
          },
        },
        create: {
          userId,
          plateforme: googleAds.id,
          compteId: compte.compteId,
          nom: compte.nom,
          devise: compte.devise,
          fuseau: compte.fuseau,
          gestionnaire: compte.gestionnaire,
        },
        /*
         * `actif` n'est pas touché : une reconnexion ne doit pas déplacer le choix de la
         * personne vers un autre compte sans qu'elle l'ait demandé.
         */
        update: {
          nom: compte.nom,
          devise: compte.devise,
          fuseau: compte.fuseau,
          gestionnaire: compte.gestionnaire,
        },
      }),
    )
  }

  /*
   * Le choix d'office, et sa seule condition : un unique compte qui diffuse. Deux comptes,
   * ou un seul mais gestionnaire, et c'est à la personne de trancher — le mauvais choix
   * fait par le produit coûte un tableau de bord vide qu'on cherche ailleurs.
   */
  if (dejaActif === null) {
    const diffusants = lecture.valeur.filter((compte) => !compte.gestionnaire)
    const seul = diffusants.length === 1 ? diffusants[0] : undefined
    if (seul !== undefined) {
      await withUserScope(userId, (tx) =>
        tx.adsAccount.updateMany({
          where: { userId, plateforme: googleAds.id, compteId: seul.compteId },
          data: { actif: true },
        }),
      )
    }
  }

  logger.info('comptes Google Ads enregistrés', { nombre: lecture.valeur.length })
  return { ok: true, comptes: await listerComptesRelies(userId) }
}

/** Désigne le compte que Naya suit. Un seul à la fois, et il doit être à cette personne. */
export async function choisirCompte(userId: string, adsAccountId: string): Promise<CompteRelie> {
  const compte = await withUserScope(userId, (tx) =>
    tx.adsAccount.findFirst({ where: { id: adsAccountId, userId } }),
  )
  if (compte === null) throw notFound('Ce compte publicitaire est introuvable.')
  if (compte.gestionnaire) {
    /*
     * Refusé plutôt que permis en silence : un compte administrateur n'a ni dépense ni
     * conversion, et le suivre donnerait un écran vide sans que rien n'explique pourquoi.
     */
    throw validation(
      'Ce compte est un compte administrateur : il ne diffuse pas de publicité. Choisissez un compte qui a des campagnes.',
    )
  }

  await withUserScope(userId, async (tx) => {
    await tx.adsAccount.updateMany({
      where: { userId, plateforme: googleAds.id, actif: true },
      data: { actif: false },
    })
    await tx.adsAccount.updateMany({ where: { id: adsAccountId, userId }, data: { actif: true } })
  })

  return { ...vue(compte), actif: true }
}

/**
 * De quoi lire chez Google : un jeton frais et le compte suivi.
 *
 * Le renouvellement du jeton est délégué à la couche d'intégrations, qui le fait déjà pour
 * Search Console et Shopify. Un connecteur qui gérerait son propre cycle de vie de jeton le
 * ferait à sa façon, et il y aurait autant de façons que de connecteurs.
 */
export async function accesCompteActif(
  userId: string,
): Promise<{ ok: true; acces: AccesAds; compte: CompteRelie } | { ok: false; raison: string }> {
  const compte = await compteActif(userId)
  if (compte === null) {
    return { ok: false, raison: 'Aucun compte Google Ads n’est suivi pour l’instant.' }
  }

  const acces = await useOAuthAccess(userId, googleAds.id, googleAds.rafraichir)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  return {
    ok: true,
    acces: { accessToken: acces.accessToken, compteId: compte.compteId },
    compte,
  }
}
