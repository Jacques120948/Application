import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { useOAuthAccess } from '@/server/integrations/service'
import { googleAds } from './google-ads'
import type { AccesAds, AdPlatformAuth } from './provider'

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
 *
 * **Chaque plateforme a son compte suivi.** Naya suit un compte Google, MIRA un compte Meta,
 * et les deux cohabitent : « actif » s'entend par plateforme, jamais globalement. Les
 * fonctions prennent donc la plateforme en paramètre, avec Google par défaut — les appels
 * écrits avant que Meta n'existe continuent de désigner ce qu'ils ont toujours désigné.
 *
 * **Un compte dont le détail n'a pas été lu n'est pas choisissable.** Il arrive qu'une
 * autorisation couvre un compte fermé, suspendu, ou dont le compte Google n'a plus les
 * droits : Google le liste encore, mais refuse d'en dire le nom, la devise et le fuseau. Le
 * proposer quand même donnerait un tableau de bord vide sans que rien ne l'explique — et
 * c'est la devise absente qui le trahit, puisque Google la rend toujours pour un compte
 * lisible.
 */

export type CompteRelie = {
  id: string
  /** « google-ads » ou « meta-ads » : qui de Naya ou de MIRA suit ce compte. */
  plateforme: string
  compteId: string
  nom: string
  devise: string
  fuseau: string
  gestionnaire: boolean
  actif: boolean
  /** lecture | assiste : ce que Naya a le droit de faire ici. Voir `actions.ts`. */
  mode: string
  synchroAt: Date | null
  /** Dernière lecture du créatif. Séparée : elle n'a pas le rythme des dépenses. */
  creaAt: Date | null
  /**
   * Combien d'actions de conversion comptent réellement : activées ET comptées.
   *
   * -1 quand rien n'a encore été lu, ce qui n'est pas 0. La distinction porte une règle
   * entière : sur -1 elle se tait, sur 0 elle alerte.
   */
  conversionsActives: number
  /**
   * Le détail du compte a pu être lu chez Google.
   *
   * Dérivé de la devise plutôt que conservé : Google la rend toujours pour un compte
   * lisible, et une colonne de plus serait une vérité à tenir à jour en double.
   */
  lisible: boolean
}

/** Le compte suivi sur cette plateforme, ou `null` quand aucun n'est relié. */
export async function compteActif(
  userId: string,
  plateforme: string = googleAds.id,
): Promise<CompteRelie | null> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsAccount.findFirst({
      where: { userId, plateforme, actif: true },
      orderBy: { createdAt: 'asc' },
    }),
  )
  return ligne === null ? null : vue(ligne)
}

function vue(ligne: {
  id: string
  plateforme: string
  compteId: string
  nom: string
  devise: string
  fuseau: string
  gestionnaire: boolean
  actif: boolean
  mode: string
  synchroAt: Date | null
  creaAt: Date | null
  conversionsActives: number
}): CompteRelie {
  return {
    id: ligne.id,
    plateforme: ligne.plateforme,
    compteId: ligne.compteId,
    nom: ligne.nom,
    devise: ligne.devise,
    fuseau: ligne.fuseau,
    gestionnaire: ligne.gestionnaire,
    actif: ligne.actif,
    conversionsActives: ligne.conversionsActives,
    mode: ligne.mode,
    synchroAt: ligne.synchroAt,
    creaAt: ligne.creaAt,
    lisible: ligne.devise !== '',
  }
}

export async function listerComptesRelies(
  userId: string,
  plateforme: string = googleAds.id,
): Promise<CompteRelie[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsAccount.findMany({
      where: { userId, plateforme },
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
  plateforme: AdPlatformAuth = googleAds,
): Promise<{ ok: true; comptes: CompteRelie[] } | { ok: false; raison: string }> {
  const lecture = await plateforme.listerComptes(accessToken)
  if (!lecture.ok) return lecture

  const dejaActif = await compteActif(userId, plateforme.id)

  for (const compte of lecture.valeur) {
    await withUserScope(userId, (tx) =>
      tx.adsAccount.upsert({
        where: {
          userId_plateforme_compteId: {
            userId,
            plateforme: plateforme.id,
            compteId: compte.compteId,
          },
        },
        create: {
          userId,
          plateforme: plateforme.id,
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
    const diffusants = lecture.valeur.filter(
      (compte) => !compte.gestionnaire && compte.devise !== '',
    )
    const seul = diffusants.length === 1 ? diffusants[0] : undefined
    if (seul !== undefined) {
      await withUserScope(userId, (tx) =>
        tx.adsAccount.updateMany({
          where: { userId, plateforme: plateforme.id, compteId: seul.compteId },
          data: { actif: true },
        }),
      )
    }
  }

  logger.info('comptes publicitaires enregistrés', {
    plateforme: plateforme.id,
    nombre: lecture.valeur.length,
  })
  return { ok: true, comptes: await listerComptesRelies(userId, plateforme.id) }
}

/** Désigne le compte que Naya suit. Un seul à la fois, et il doit être à cette personne. */
/**
 * Retire un compte publicitaire de la liste.
 *
 * Réservé aux comptes qu'Evoliia n'a pas pu lire, et c'est tout l'objet : un compte fermé,
 * suspendu ou auquel on a perdu l'accès reste affiché — il le faut, le cacher ferait
 * chercher un compte qu'on sait posséder — mais il encombre indéfiniment une liste où l'on
 * vient désigner celui qu'on suit.
 *
 * Deux refus, et ils sont là pour la même raison.
 *
 * **Un compte lisible ne se retire pas ici.** Il porte des campagnes, des relevés, des
 * constats, parfois des modifications journalisées. Les effacer d'un bouton posé au milieu
 * d'un écran de réglage serait offrir une perte irréversible à portée de clic distrait. Le
 * jour où il faudra pouvoir le faire, ce sera un geste à part, avec ce qu'il emporte écrit
 * devant.
 *
 * **Un compte suivi ne se retire pas non plus.** On ne retire pas le sol sous ses pieds ;
 * et un compte suivi est lisible, donc déjà refusé par la première règle — la seconde
 * existe pour que le jour où la première changerait, celle-ci tienne encore.
 *
 * Sans effet chez la plateforme : Evoliia oublie le compte, elle ne le ferme pas.
 */
export async function retirerCompte(userId: string, adsAccountId: string): Promise<void> {
  const compte = await withUserScope(userId, (tx) =>
    tx.adsAccount.findFirst({ where: { id: adsAccountId, userId } }),
  )
  if (compte === null) throw notFound('Ce compte publicitaire est introuvable.')

  /*
   * La devise vide est la marque d'un compte illisible : elle vient de la plateforme, et une
   * lecture qui a abouti la rend toujours. Refusé côté serveur et pas seulement absent de
   * l'écran — ce qui arrive du navigateur désigne, il n'autorise pas.
   */
  if (compte.devise !== '') {
    throw validation(
      'Ce compte est lisible : Evoliia peut en montrer les chiffres. Seuls les comptes devenus illisibles peuvent être retirés d’ici.',
    )
  }
  if (compte.actif) {
    throw validation('Ce compte est celui qui est suivi. Désignez-en un autre avant de le retirer.')
  }

  await withUserScope(userId, (tx) =>
    tx.adsAccount.deleteMany({ where: { id: adsAccountId, userId } }),
  )
}

export async function choisirCompte(userId: string, adsAccountId: string): Promise<CompteRelie> {
  const compte = await withUserScope(userId, (tx) =>
    tx.adsAccount.findFirst({ where: { id: adsAccountId, userId } }),
  )
  if (compte === null) throw notFound('Ce compte publicitaire est introuvable.')
  if (compte.devise === '') {
    /*
     * Refusé côté serveur, et pas seulement grisé à l'écran : ce qui arrive du navigateur
     * désigne, il n'autorise pas. Un compte illisible suivi donnerait un tableau de bord
     * vide, et la panne serait cherchée partout sauf ici.
     */
    throw validation(
      'Evoliia n’a pas pu lire ce compte chez Google : il est peut-être fermé, suspendu, ou votre compte Google n’y a plus accès. Choisissez-en un autre.',
    )
  }
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
    /*
     * La plateforme vient de la ligne choisie, jamais d'un défaut. Désactiver « les comptes
     * actifs » sans cette borne ferait perdre son compte Google à quelqu'un qui vient de
     * choisir son compte Meta — un tableau de bord vidé par un geste qui n'avait rien à voir,
     * et dont personne ne ferait le rapprochement.
     */
    await tx.adsAccount.updateMany({
      where: { userId, plateforme: compte.plateforme, actif: true },
      data: { actif: false },
    })
    await tx.adsAccount.updateMany({ where: { id: adsAccountId, userId }, data: { actif: true } })
  })

  return { ...vue(compte), actif: true, lisible: true }
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
  plateforme: AdPlatformAuth = googleAds,
): Promise<{ ok: true; acces: AccesAds; compte: CompteRelie } | { ok: false; raison: string }> {
  const compte = await compteActif(userId, plateforme.id)
  if (compte === null) {
    return { ok: false, raison: `Aucun compte ${plateforme.nom} n’est suivi pour l’instant.` }
  }

  const acces = await useOAuthAccess(userId, plateforme.id, plateforme.rafraichir)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  return {
    ok: true,
    acces: { accessToken: acces.accessToken, compteId: compte.compteId },
    compte,
  }
}
