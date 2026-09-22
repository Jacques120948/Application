import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { accesCompteActif } from './comptes'
import { lirePermissionsMeta, metaAds, PORTEES } from './meta-ads'

/**
 * Ce que MIRA a le droit de faire chez Meta, su plutôt que supposé.
 *
 * Le dossier de connexion enregistrait jusqu'ici les portées **demandées** par Evoliia, ce
 * qui n'est pas ce que la personne a accordé : l'écran de consentement de Meta permet de
 * décocher une permission à la volée, et le jeton part alors amputé sans que rien ne le
 * signale. Le produit affirmait donc un droit d'écriture qu'il n'avait peut-être pas.
 *
 * Trois conséquences, et aucune n'est cosmétique.
 *
 * **On le découvrirait au pire moment.** Sans cette vérification, le premier bouton
 * « appliquer » se heurterait à un refus de Meta, après avoir laissé croire que la chose
 * était possible. C'est l'endroit exact où un produit perd la confiance : pas quand il
 * refuse, quand il promet puis refuse.
 *
 * **L'écran doit pouvoir le dire avant.** « MIRA lit vos campagnes ; elle ne peut pas les
 * modifier, voici pourquoi et comment y remédier » est une phrase qu'on écrit une fois, et
 * qui évite dix questions.
 *
 * **Le dossier doit cesser de mentir.** La vérité relue est réécrite dans la connexion, à
 * la place des portées demandées. Une donnée fausse qui dort finit toujours par être lue.
 *
 * Aucun secret n'entre ni ne sort d'ici : le jeton est obtenu par la couche d'intégration,
 * employé une fois, et ne figure dans aucun retour ni aucun journal.
 */

/** Lire les campagnes, les ensembles et les annonces. Sans elle, MIRA ne voit rien. */
export const PERMISSION_LECTURE = 'ads_read'

/** Modifier un budget, mettre en pause. Sans elle, MIRA ne peut que proposer. */
export const PERMISSION_ECRITURE = 'ads_management'

export type DroitsMeta = {
  /** Vrai quand Meta a accordé la lecture des campagnes. */
  lire: boolean
  /** Vrai quand Meta a accordé la modification. C'est lui qui ouvre les boutons. */
  ecrire: boolean
  /** Les portées demandées et non accordées, pour l'expliquer sans deviner. */
  manquantes: string[]
}

/** Aucun droit : la valeur de repli, et elle est fermée. */
export const AUCUN_DROIT: DroitsMeta = { lire: false, ecrire: false, manquantes: [...PORTEES] }

/**
 * Ce que disent des portées accordées, quelle qu'en soit l'origine.
 *
 * Pure, donc testable sans réseau ni base — et c'est la fonction qui décide si un bouton
 * d'écriture existe. Une porte de cette importance ne doit pas dépendre d'un appel réseau
 * pour être vérifiable.
 */
export function droitsDepuisPortees(accordees: readonly string[]): DroitsMeta {
  const vues = new Set(accordees)
  return {
    lire: vues.has(PERMISSION_LECTURE),
    ecrire: vues.has(PERMISSION_ECRITURE),
    manquantes: PORTEES.filter((portee) => !vues.has(portee)),
  }
}

/**
 * Les droits tels qu'ils sont enregistrés, sans appeler Meta.
 *
 * C'est la lecture que font les écrans : une page qui interrogerait Meta à chaque affichage
 * ajouterait un aller-retour réseau à chaque visite, pour une réponse qui ne change qu'au
 * moment où l'on reconnecte.
 */
export async function droitsMeta(userId: string): Promise<DroitsMeta> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.integrationConnection.findFirst({
      where: { userId, providerId: metaAds.id, disconnectedAt: null },
      select: { scopes: true },
    }),
  )
  return ligne === null ? AUCUN_DROIT : droitsDepuisPortees(ligne.scopes)
}

/**
 * Redemande à Meta ce qu'il a accordé, et corrige le dossier.
 *
 * Appelée dans la foulée de la lecture des campagnes : c'est le seul moment où l'on tient
 * déjà un jeton valide, et un appel de plus y est négligeable — là où le faire à l'affichage
 * coûterait un aller-retour à chaque visite.
 *
 * Ne lève pas. Un échec laisse le dossier tel quel plutôt que de le vider : effacer les
 * portées sur une panne réseau fermerait les boutons de quelqu'un dont les droits n'ont pas
 * bougé, et il chercherait la cause du mauvais côté.
 */
export async function rafraichirDroitsMeta(userId: string): Promise<DroitsMeta | null> {
  const acces = await accesCompteActif(userId, metaAds)
  if (!acces.ok) return null

  const lecture = await lirePermissionsMeta(acces.acces.accessToken)
  if (!lecture.ok) {
    // Ni jeton ni identifiant : un journal se relit, se copie et s'exporte.
    logger.warn('permissions Meta illisibles', { raison: lecture.raison.slice(0, 120) })
    return null
  }

  const droits = droitsDepuisPortees(lecture.valeur.accordees)
  await withUserScope(userId, (tx) =>
    tx.integrationConnection.updateMany({
      where: { userId, providerId: metaAds.id, disconnectedAt: null },
      data: { scopes: lecture.valeur.accordees },
    }),
  )

  logger.info('droits Meta relus', { lire: droits.lire, ecrire: droits.ecrire })
  return droits
}
