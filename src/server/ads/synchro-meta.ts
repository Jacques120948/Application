import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { accesCompteActif } from './comptes'
import { rafraichirDroitsMeta } from './droits-meta'
import {
  lireAnnoncesMeta,
  lireCampagnesMeta,
  lireEnsemblesMeta,
  lireJourneesMeta,
  metaAds,
  type JourneeMeta,
  type NiveauMeta,
} from './meta-ads'
import type { AccesAds } from './provider'
import { fenetre } from './metriques'

/**
 * La lecture des campagnes Meta, aux trois étages.
 *
 * Six appels par compte et par lecture : campagnes, ensembles, annonces, puis les journées
 * de chacun des trois niveaux. Pas un par objet, et la différence n'est pas une élégance —
 * le plafond d'appels appartient à l'application Meta d'Evoliia et se partage entre tous les
 * comptes reliés. Une boucle par annonce coûterait à tout le monde ce qu'elle ferait gagner
 * à un seul.
 *
 * Quatre décisions, dont trois reprises de la lecture Google parce qu'elles n'ont rien de
 * propre à Google.
 *
 * **La première lecture remonte loin, les suivantes non.** Sans historique, aucune
 * comparaison n'est possible et le tableau de bord ne dit rien d'autre qu'un état.
 *
 * **Les journées récentes sont réécrites, pas ajoutées.** Meta rattache des achats après
 * coup, pendant plusieurs jours, selon la fenêtre d'attribution du compte. Une journée figée
 * le soir même serait fausse le lendemain — et c'est exactement le chiffre sur lequel une
 * recommandation s'appuierait.
 *
 * **Un objet disparu n'est pas effacé.** Son historique reste : « vous dépensiez là il y a
 * trois semaines » est une information.
 *
 * **Les trois étages partagent une table et se distinguent par deux colonnes.** Voir
 * `niveaux.ts` : une somme qui ne filtre pas l'étage compte la même dépense trois fois. La
 * fenêtre est donc effacée en entier, puis réécrite en entier — les trois niveaux ensemble,
 * jamais l'un sans les autres, faute de quoi un total mélangerait des jours anciens à un
 * étage et des jours neufs à un autre.
 */

/**
 * Ce que la première lecture remonte, **au niveau des campagnes seulement**.
 *
 * Assez pour comparer un mois au mois précédent. Le détail, lui, ne remonte pas si loin :
 * voir `JOURS_DETAIL`, et la panne qui l'a imposé.
 */
export const JOURS_PREMIERE_LECTURE = 90

/**
 * Ce que les lectures suivantes relisent.
 *
 * Vingt-huit jours, plus que pour Google, et la raison est l'attribution : la fenêtre par
 * défaut de Meta rattache un achat jusqu'à sept jours après le clic, et certains comptes
 * remontent plus loin. Relire trop court fige des journées que Meta corrigera ensuite.
 */
export const JOURS_RELECTURE = 28

/**
 * Ce que les ensembles et les annonces remontent, toujours.
 *
 * Vingt-huit jours, même à la première lecture, et c'est une leçon payée : quatre-vingt-dix
 * jours multipliés par une ligne par jour et par annonce font des dizaines de milliers de
 * lignes, que Meta rend cinq cents à la fois. La première lecture d'un compte ordinaire
 * dépassait la minute et l'hébergement la coupait — un 504 sans explication, sur un bouton
 * qui venait d'annoncer « une minute ».
 *
 * L'histoire longue n'est de toute façon utile qu'au niveau des campagnes : personne
 * n'analyse une annonce sur trois mois, et Meta les renouvelle bien plus vite que ça.
 */
export const JOURS_DETAIL = 28

/**
 * Le nombre d'écritures par transaction.
 *
 * Vingt, et le chiffre vient d'une panne. Regrouper toutes les écritures d'un étage dans une
 * seule transaction était censé éviter d'en ouvrir une par objet ; sur un compte à cent
 * quatorze campagnes et ses centaines d'ensembles, cette transaction unique dépassait les
 * quinze secondes que la portée s'autorise, et la lecture échouait sur une erreur qui ne
 * disait rien — après avoir écrit les campagnes, ce qui laissait l'écran dans un état à
 * moitié vrai.
 *
 * Par paquets, donc. Une transaction par objet coûte trop cher, une pour tous ne tient pas :
 * le nombre d'objets ne doit décider ni du nombre de transactions ni de leur durée.
 */
const PAR_TRANSACTION = 20

/** Découpe une liste en paquets de `taille`. */
function paquets<T>(liste: readonly T[], taille: number): T[][] {
  const tranches: T[][] = []
  for (let debut = 0; debut < liste.length; debut += taille) {
    tranches.push(liste.slice(debut, debut + taille))
  }
  return tranches
}

export type BilanMeta = {
  campagnes: number
  ensembles: number
  annonces: number
  journees: number
  /** Appels réellement faits chez Meta, pagination comprise : c'est ce qui se compare au plafond. */
  appels: number
}

type LigneReleve = {
  userId: string
  accountId: string
  campagneId: string
  groupeId: string
  annonceId: string
  jour: Date
  coutMicros: bigint
  impressions: bigint
  clics: bigint
  portee: bigint
  conversions: number
  valeurConversion: number
}

/**
 * Lit un compte Meta et le range.
 *
 * Ne lève pas : un refus est une valeur de retour, parce que cette fonction est appelée dans
 * une boucle qui ne doit pas s'interrompre.
 */
/**
 * La largeur d'une demande d'insights, en jours, et pourquoi elle dépend du niveau.
 *
 * Les chiffres viennent d'une panne. Meta facture une demande d'insights au produit
 * « objets × jours » : cinq cent soixante-neuf annonces sur vingt-huit jours lui demandent
 * d'agréger seize mille lignes avant de rendre la première page. Au-delà d'un certain
 * volume il ne rend plus rien à temps, et l'appel meurt sur son propre délai — « Meta est
 * momentanément injoignable », alors que Meta va très bien et que c'est nous qui avons trop
 * demandé.
 *
 * D'où une largeur par étage plutôt qu'une largeur unique, parce que le nombre d'objets
 * n'est pas du tout le même : un compte porte des dizaines de campagnes, des centaines
 * d'ensembles et des milliers d'annonces. Découper les campagnes aussi finement que les
 * annonces multiplierait les appels sans rien alléger — et le plafond d'appels appartient à
 * l'application Meta d'Evoliia, partagé entre tous les comptes reliés.
 *
 * La fenêtre couverte, elle, ne change pas : c'est la même, découpée.
 */
export const TRANCHES_PAR_NIVEAU: Record<NiveauMeta, number> = {
  campaign: 30,
  adset: 7,
  ad: 7,
}

const JOUR_MS = 24 * 60 * 60 * 1000

/**
 * Découpe une fenêtre en tranches d'au plus `jours` journées, bornes comprises.
 *
 * Pure et exportée pour être vérifiable : une tranche qui déborderait d'un jour ferait
 * relire deux fois la même journée — sans erreur visible, puisque l'écriture est un
 * remplacement — et une tranche qui en oublierait un laisserait un trou dans une courbe.
 */
export function tranches(
  depuis: string,
  jusqua: string,
  jours: number,
): Array<{ depuis: string; jusqua: string }> {
  const debut = Date.parse(`${depuis}T00:00:00Z`)
  const fin = Date.parse(`${jusqua}T00:00:00Z`)
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin < debut) {
    return [{ depuis, jusqua }]
  }

  const largeur = Math.max(1, Math.floor(jours))
  const decoupe: Array<{ depuis: string; jusqua: string }> = []
  for (let curseur = debut; curseur <= fin; curseur += largeur * JOUR_MS) {
    const borne = Math.min(curseur + (largeur - 1) * JOUR_MS, fin)
    decoupe.push({
      depuis: new Date(curseur).toISOString().slice(0, 10),
      jusqua: new Date(borne).toISOString().slice(0, 10),
    })
  }
  return decoupe
}

/**
 * Les journées d'un niveau, demandées par tranches et recollées.
 *
 * Les tranches s'enchaînent au lieu de partir ensemble : elles visent le même compte, et
 * Meta compte les appels par compte. Trois niveaux qui lanceraient chacun quatre demandes
 * simultanées feraient douze appels d'un coup sur un plafond partagé par tous les comptes
 * reliés à Evoliia.
 *
 * Un refus sur une tranche arrête tout : une fenêtre à trous serait pire qu'une fenêtre
 * absente, parce qu'elle se lit comme une baisse de dépense.
 */
async function journeesParTranches(
  acces: AccesAds,
  niveau: NiveauMeta,
  depuis: string,
  jusqua: string,
): Promise<{ ok: true; valeur: JourneeMeta[] } | { ok: false; raison: string }> {
  const toutes: JourneeMeta[] = []
  for (const tranche of tranches(depuis, jusqua, TRANCHES_PAR_NIVEAU[niveau])) {
    const lecture = await lireJourneesMeta(acces, niveau, tranche.depuis, tranche.jusqua)
    if (!lecture.ok) return lecture
    toutes.push(...lecture.valeur)
  }
  return { ok: true, valeur: toutes }
}

export async function synchroniserCompteMeta(
  userId: string,
): Promise<{ ok: true; bilan: BilanMeta } | { ok: false; raison: string }> {
  const ouverture = await accesCompteActif(userId, metaAds)
  if (!ouverture.ok) return ouverture

  const { acces, compte } = ouverture

  /*
   * La structure d'abord, dans l'ordre de ses rattachements : une annonce dont l'ensemble
   * n'existe pas encore en base n'aurait nulle part où aller, et un ensemble sans sa
   * campagne non plus.
   */
  const campagnes = await lireCampagnesMeta(acces)
  if (!campagnes.ok) return campagnes

  /*
   * Les écritures d'un même étage tiennent dans une seule portée. Une transaction par objet
   * ouvrait une portée et posait une variable de session pour chaque annonce — le nombre
   * d'objets ne doit pas décider du nombre de transactions.
   */
  const parCampagne = new Map<string, string>()
  for (const paquet of paquets(campagnes.valeur, PAR_TRANSACTION)) {
   await withUserScope(userId, async (tx) => {
    for (const campagne of paquet) {
     const ligne = await (tx.adsCampagne.upsert({
        where: {
          accountId_campagneId: { accountId: compte.id, campagneId: campagne.campagneId },
        },
        create: {
          userId,
          accountId: compte.id,
          campagneId: campagne.campagneId,
          nom: campagne.nom,
          type: campagne.type,
          statut: campagne.statut,
          budgetMicros: BigInt(campagne.budgetMicros),
        },
        update: {
          nom: campagne.nom,
          type: campagne.type,
          statut: campagne.statut,
          budgetMicros: BigInt(campagne.budgetMicros),
          vueAt: new Date(),
        },
        select: { id: true },
      }))
     parCampagne.set(campagne.campagneId, ligne.id)
    }
   })
  }

  const ensembles = await lireEnsemblesMeta(acces)
  if (!ensembles.ok) return ensembles

  const parEnsemble = new Map<string, string>()
  for (const paquet of paquets(ensembles.valeur, PAR_TRANSACTION)) {
   await withUserScope(userId, async (tx) => {
    for (const ensemble of paquet) {
     const campagneId = parCampagne.get(ensemble.campagneId)
     if (campagneId === undefined) continue
     const ligne = await (tx.adsGroupe.upsert({
        where: { accountId_groupeId: { accountId: compte.id, groupeId: ensemble.ensembleId } },
        create: {
          userId,
          accountId: compte.id,
          campagneId,
          groupeId: ensemble.ensembleId,
          nom: ensemble.nom,
          /*
           * « annonces » et non un troisième mot : chez Meta comme chez Google, ce contenant
           * porte des annonces. Le vocabulaire de la plateforme reste à l'écran, le rôle
           * reste dans la base — c'est ce qui évite un code plein de conditions.
           */
          genre: 'annonces',
          statut: ensemble.statut,
          budgetMicros: BigInt(ensemble.budgetMicros),
        },
        update: {
          campagneId,
          nom: ensemble.nom,
          statut: ensemble.statut,
          budgetMicros: BigInt(ensemble.budgetMicros),
          vueAt: new Date(),
        },
        select: { id: true },
      }))
     parEnsemble.set(ensemble.ensembleId, ligne.id)
    }
   })
  }

  const annonces = await lireAnnoncesMeta(acces)
  if (!annonces.ok) return annonces

  let annoncesEcrites = 0
  for (const paquet of paquets(annonces.valeur, PAR_TRANSACTION)) {
   await withUserScope(userId, async (tx) => {
    for (const annonce of paquet) {
     const groupeId = parEnsemble.get(annonce.ensembleId)
     if (groupeId === undefined) continue
     await (tx.adsAnnonce.upsert({
        where: { accountId_annonceId: { accountId: compte.id, annonceId: annonce.annonceId } },
        create: {
          userId,
          accountId: compte.id,
          groupeId,
          annonceId: annonce.annonceId,
          nom: annonce.nom,
          statut: annonce.statut,
          apercu: annonce.apercu,
        },
        update: {
          groupeId,
          nom: annonce.nom,
          statut: annonce.statut,
          apercu: annonce.apercu,
          vueAt: new Date(),
        },
      }))
     annoncesEcrites += 1
    }
   })
  }

  const premiere = compte.synchroAt === null

  /*
   * Deux fenêtres, et non une. La campagne remonte loin, le détail non.
   *
   * C'est la correction d'une vraie panne : quatre-vingt-dix jours multipliés par une ligne
   * par jour et par annonce font des dizaines de milliers de lignes, que Meta rend cinq
   * cents à la fois. La première lecture dépassait la minute et l'hébergement la coupait —
   * un 504 sans explication, sur un bouton qui venait d'annoncer « une minute ».
   */
  const bornes = fenetre(premiere ? JOURS_PREMIERE_LECTURE : JOURS_RELECTURE, compte.fuseau)
  const detail = fenetre(Math.min(JOURS_DETAIL, premiere ? JOURS_PREMIERE_LECTURE : JOURS_RELECTURE), compte.fuseau)

  /*
   * Les trois niveaux sont lus en parallèle : ils ne dépendent pas l'un de l'autre, et les
   * enchaîner tripleraient l'attente pour rien. Un refus sur l'un arrête tout — une fenêtre
   * réécrite avec deux étages sur trois donnerait des totaux qui ne se recoupent pas.
   */
  const [parJourCampagne, parJourEnsemble, parJourAnnonce] = await Promise.all([
    journeesParTranches(acces, 'campaign', bornes.depuis, bornes.jusqua),
    journeesParTranches(acces, 'adset', detail.depuis, detail.jusqua),
    journeesParTranches(acces, 'ad', detail.depuis, detail.jusqua),
  ])
  if (!parJourCampagne.ok) return parJourCampagne
  if (!parJourEnsemble.ok) return parJourEnsemble
  if (!parJourAnnonce.ok) return parJourAnnonce

  const lignes: LigneReleve[] = []
  for (const journee of [
    ...parJourCampagne.valeur,
    ...parJourEnsemble.valeur,
    ...parJourAnnonce.valeur,
  ]) {
    const campagneId = parCampagne.get(journee.campagneId)
    /*
     * Une journée d'une campagne absente du relevé : cela arrive pour une campagne supprimée
     * qui a dépensé pendant la fenêtre. On la laisse tomber plutôt que d'inventer une ligne
     * de campagne à partir d'un identifiant sans nom ni objectif.
     */
    if (campagneId === undefined) continue

    lignes.push({
      userId,
      accountId: compte.id,
      campagneId,
      /*
       * Les identifiants de Meta, pas les nôtres : ces deux colonnes désignent l'étage, et
       * `niveaux.ts` les compare à la chaîne vide. Y ranger une clé interne obligerait à
       * la résoudre pour savoir de quel étage on parle.
       */
      groupeId: journee.ensembleId,
      annonceId: journee.annonceId,
      jour: new Date(`${journee.jour}T00:00:00Z`),
      coutMicros: BigInt(journee.coutMicros),
      impressions: BigInt(journee.impressions),
      clics: BigInt(journee.clics),
      portee: BigInt(journee.portee),
      conversions: journee.achats,
      valeurConversion: journee.valeurAchats,
    })
  }

  const ecrites = lignes.length

  /*
   * L'effacement d'abord, dans sa propre transaction, puis l'écriture par paquets.
   *
   * La séparation a un coût assumé : une écriture interrompue en son milieu laisse la
   * fenêtre à moitié remplie. C'est le moindre mal — la relecture suivante la réécrit
   * entièrement, alors qu'une transaction unique de plusieurs milliers de lignes dépasserait
   * les quinze secondes de la portée et ne laisserait, elle, jamais rien.
   */
  await withUserScope(userId, async (tx) => {
    /*
     * Deux effacements, un par fenêtre, chacun borné à ses étages. Un seul effacement sur la
     * fenêtre longue emporterait des journées de détail qu'on ne réécrit pas — et un écran
     * qui montrerait des campagnes sur trois mois et des annonces sur trois semaines, sans
     * que rien n'explique le trou.
     */
    await tx.adsReleve.deleteMany({
      where: {
        userId,
        accountId: compte.id,
        groupeId: '',
        annonceId: '',
        jour: {
          gte: new Date(`${bornes.depuis}T00:00:00Z`),
          lte: new Date(`${bornes.jusqua}T00:00:00Z`),
        },
      },
    })
    await tx.adsReleve.deleteMany({
      where: {
        userId,
        accountId: compte.id,
        NOT: { groupeId: '', annonceId: '' },
        jour: {
          gte: new Date(`${detail.depuis}T00:00:00Z`),
          lte: new Date(`${detail.jusqua}T00:00:00Z`),
        },
      },
    })
  })

  for (const paquet of paquets(lignes, PAR_TRANSACTION * 50)) {
    await withUserScope(userId, (tx) =>
      tx.adsReleve.createMany({ data: paquet, skipDuplicates: true }),
    )
  }

  await withUserScope(userId, (tx) =>
    tx.adsAccount.updateMany({ where: { id: compte.id, userId }, data: { synchroAt: new Date() } }),
  )

  const bilan: BilanMeta = {
    campagnes: campagnes.valeur.length,
    ensembles: ensembles.valeur.length,
    annonces: annoncesEcrites,
    journees: ecrites,
    /* Six au minimum : la pagination peut en ajouter, et le chiffre reste un plancher dit. */
    appels: 6,
  }
  /*
   * Les droits réellement accordés, relus pendant qu'on tient un jeton valide.
   *
   * Un appel de plus ici est négligeable ; le faire à l'affichage coûterait un aller-retour
   * à chaque visite, pour une réponse qui ne change qu'au moment où l'on reconnecte. Son
   * échec n'est pas celui de la lecture : les campagnes, elles, sont bien en base.
   */
  await rafraichirDroitsMeta(userId).catch(() => null)

  logger.info('compte Meta synchronisé', { ...bilan, premiere })
  return { ok: true, bilan }
}

/**
 * La tournée des comptes Meta.
 *
 * Elle ne demande aucun réglage : relier un compte est l'accord. Un compte qui échoue
 * n'arrête pas la tournée — autorisation révoquée, compte suspendu, Meta indisponible sont
 * des états ordinaires, comptés et dépassés.
 */
export async function synchroniserTousMeta(): Promise<{ comptes: number; echecs: number }> {
  const comptes = await prisma.adsAccount.findMany({
    where: { plateforme: metaAds.id, actif: true },
    select: { userId: true },
  })

  let faits = 0
  let echecs = 0
  for (const compte of comptes) {
    const issue = await synchroniserCompteMeta(compte.userId).catch(() => ({
      ok: false as const,
      raison: 'inattendu',
    }))
    if (issue.ok) faits += 1
    else echecs += 1
  }

  logger.info('tournée Meta passée', { comptes: faits, echecs })
  return { comptes: faits, echecs }
}
