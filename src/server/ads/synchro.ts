import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { accesCompteActif } from './comptes'
import { googleAds } from './google-ads'
import { fenetre, jourDansFuseau } from './metriques'

/**
 * La lecture nocturne des campagnes.
 *
 * Deux appels par compte et par nuit : les campagnes, puis les journées. Pas un par
 * campagne, et la différence n'est pas une élégance — le plafond d'appels appartient au
 * projet Google Cloud d'Evoliia et se partage entre tous les comptes reliés. Une boucle par
 * campagne coûterait à tout le monde ce qu'elle ferait gagner à un seul.
 *
 * Quatre décisions portent ce module.
 *
 * **La première lecture remonte loin, les suivantes non.** Sans historique, aucune
 * comparaison n'est possible et le tableau de bord ne dit rien d'autre qu'un état. Une fois
 * l'historique constitué, relire quatre-vingt-dix jours chaque nuit serait payer très cher
 * une information qu'on possède déjà.
 *
 * **Les journées récentes sont réécrites, pas ajoutées.** Google corrige ses conversions
 * pendant plusieurs jours : une vente d'aujourd'hui peut être rattachée à un clic de mardi.
 * Une journée figée le soir même serait fausse le lendemain, et c'est exactement le chiffre
 * sur lequel une recommandation s'appuierait.
 *
 * **Une campagne disparue n'est pas effacée.** Son historique reste : « vous dépensiez là
 * il y a trois semaines » est une information, et la perdre en même temps que la campagne
 * priverait le tableau de bord de la moitié de ce qu'il explique.
 *
 * **Un compte qui échoue n'arrête pas la tournée.** Une autorisation révoquée, un compte
 * suspendu, Google indisponible : ce sont des états ordinaires. Ils sont comptés et la nuit
 * continue.
 */

/** Ce que la première lecture remonte. Assez pour comparer un mois au mois précédent. */
export const JOURS_PREMIERE_LECTURE = 90

/**
 * Ce que les lectures suivantes relisent.
 *
 * Quatorze jours : Google révise ses chiffres sur une fenêtre de quelques jours, et une
 * marge confortable coûte les mêmes deux appels — c'est le nombre de lignes qui change, pas
 * le nombre de requêtes.
 */
export const JOURS_RELECTURE = 14

/** En deçà, une synchronisation de plus n'apprendrait rien. */
const FRAICHEUR_MS = 20 * 60 * 60 * 1000

export type BilanSynchro = {
  campagnes: number
  journees: number
  /** Appels réellement faits chez Google : c'est ce qui se compare au plafond. */
  appels: number
}

/**
 * Lit les campagnes et les journées d'un compte, et les range.
 *
 * Ne lève pas : un refus est une valeur de retour, parce que cette fonction est appelée
 * dans une boucle qui ne doit pas s'interrompre.
 */
export async function synchroniserCompte(
  userId: string,
): Promise<{ ok: true; bilan: BilanSynchro } | { ok: false; raison: string }> {
  const ouverture = await accesCompteActif(userId)
  if (!ouverture.ok) return ouverture

  const { acces, compte } = ouverture

  const campagnes = await googleAds.lireCampagnes(acces)
  if (!campagnes.ok) return campagnes

  /*
   * Les campagnes d'abord : les journées s'y rattachent, et une journée dont la campagne
   * n'existe pas encore en base n'aurait nulle part où aller.
   */
  const parIdentifiant = new Map<string, string>()
  for (const campagne of campagnes.valeur) {
    const ligne = await withUserScope(userId, (tx) =>
      tx.adsCampagne.upsert({
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
          budgetMicros: BigInt(Math.round(campagne.budgetMicros)),
          budgetId: campagne.budgetId,
          budgetLimite: campagne.budgetLimite,
        },
        update: {
          nom: campagne.nom,
          type: campagne.type,
          statut: campagne.statut,
          budgetMicros: BigInt(Math.round(campagne.budgetMicros)),
          budgetId: campagne.budgetId,
          budgetLimite: campagne.budgetLimite,
          vueAt: new Date(),
        },
        select: { id: true },
      }),
    )
    parIdentifiant.set(campagne.campagneId, ligne.id)
  }

  const premiere = compte.synchroAt === null
  const bornes = fenetre(
    premiere ? JOURS_PREMIERE_LECTURE : JOURS_RELECTURE,
    compte.fuseau,
  )
  const journees = await googleAds.lireJournees(acces, bornes.depuis, bornes.jusqua)
  if (!journees.ok) return journees

  /*
   * Les journées sont préparées en mémoire, puis écrites en deux requêtes : la fenêtre est
   * effacée, puis réécrite d'un bloc. C'est exactement la même règle qu'avant — Google
   * corrige ses conversions pendant plusieurs jours, donc une journée relue remplace celle
   * qu'on avait — mais une transaction cloisonnée par ligne ouvrait une portée et posait
   * une variable de session pour chaque case d'un tableau de quatre-vingt-dix jours par
   * huit campagnes. Le nombre de journées ne doit pas décider du nombre de transactions.
   */
  const lignes: Array<{
    userId: string
    accountId: string
    campagneId: string
    jour: Date
    coutMicros: bigint
    impressions: bigint
    clics: bigint
    conversions: number
    valeurConversion: number
  }> = []
  for (const journee of journees.valeur) {
    const campagneId = parIdentifiant.get(journee.campagneId)
    /*
     * Une journée d'une campagne absente du relevé des campagnes : cela arrive pour une
     * campagne supprimée qui a dépensé pendant la fenêtre. On la laisse tomber plutôt que
     * d'inventer une ligne de campagne à partir d'un identifiant sans nom ni type.
     */
    if (campagneId === undefined) continue
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(journee.jour)) continue

    lignes.push({
      userId,
      accountId: compte.id,
      campagneId,
      jour: new Date(`${journee.jour}T00:00:00Z`),
      coutMicros: BigInt(Math.round(journee.coutMicros)),
      impressions: BigInt(Math.round(journee.impressions)),
      clics: BigInt(Math.round(journee.clics)),
      conversions: journee.conversions,
      valeurConversion: journee.valeurConversion,
    })
  }

  const ecrites = lignes.length
  await withUserScope(userId, async (tx) => {
    await tx.adsReleve.deleteMany({
      where: {
        userId,
        accountId: compte.id,
        jour: {
          gte: new Date(`${bornes.depuis}T00:00:00Z`),
          lte: new Date(`${bornes.jusqua}T00:00:00Z`),
        },
      },
    })
    if (lignes.length > 0) await tx.adsReleve.createMany({ data: lignes, skipDuplicates: true })
  })

  await withUserScope(userId, (tx) =>
    tx.adsAccount.updateMany({ where: { id: compte.id, userId }, data: { synchroAt: new Date() } }),
  )

  const bilan: BilanSynchro = {
    campagnes: campagnes.valeur.length,
    journees: ecrites,
    /*
     * Deux, toujours : les campagnes et les journées. Le chiffre est rendu pour qu'il soit
     * mesurable plutôt que supposé — c'est lui qui dira à quelle distance du plafond
     * partagé se trouve réellement un compte, une fois qu'il aura tourné pour de vrai.
     */
    appels: 2,
  }
  logger.info('compte Google Ads synchronisé', { ...bilan, premiere })
  return { ok: true, bilan }
}

/**
 * La tournée des comptes publicitaires.
 *
 * Elle ne demande aucun réglage : relier un compte est l'accord. Faire cocher une case de
 * plus après avoir traversé l'écran de consentement de Google reviendrait à demander deux
 * fois la même chose, et la seconde serait celle qu'on oublie — le compte resterait relié,
 * la page resterait vide, et la panne serait cherchée du côté de Google.
 *
 * Elle est gratuite : aucun crédit, aucun appel à un modèle. Ce sont des lectures.
 */
export async function synchroniserTous(limite = 40): Promise<{
  comptes: number
  campagnes: number
  journees: number
  appels: number
  echecs: number
}> {
  const total = { comptes: 0, campagnes: 0, journees: 0, appels: 0, echecs: 0 }

  /*
   * Par les utilisateurs, puis par la portée de chacun. `AdsAccount` est sous Row Level
   * Security forcé : une lecture faite hors portée ne lève pas d'erreur, elle rend zéro
   * ligne — et la tournée se déclarerait passée sans avoir rien lu. C'est la panne qu'a
   * connue la surveillance hebdomadaire, et elle ne se voit dans aucun journal.
   */
  const utilisateurs = await prisma.user.findMany({
    where: { disabledAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  })

  const limiteFraicheur = new Date(Date.now() - FRAICHEUR_MS)
  for (const utilisateur of utilisateurs) {
    if (total.comptes >= limite) break
    const aFaire = await withUserScope(utilisateur.id, (tx) =>
      tx.adsAccount.count({
        where: {
          userId: utilisateur.id,
          actif: true,
          OR: [{ synchroAt: null }, { synchroAt: { lt: limiteFraicheur } }],
        },
      }),
    )
    if (aFaire === 0) continue

    total.comptes += 1
    try {
      const issue = await synchroniserCompte(utilisateur.id)
      if (!issue.ok) {
        total.echecs += 1
        continue
      }
      total.campagnes += issue.bilan.campagnes
      total.journees += issue.bilan.journees
      total.appels += issue.bilan.appels
    } catch (error) {
      total.echecs += 1
      // Ni jeton, ni identifiant de compte : un journal se relit, se copie et s'exporte.
      logger.warn('synchronisation publicitaire échouée', {
        raison: error instanceof Error ? error.message.slice(0, 120) : 'inconnu',
      })
    }
  }

  logger.info('tournée publicitaire passée', { ...total })
  return total
}

/** Le jour d'aujourd'hui dans le fuseau d'un compte. Exposé pour les écrans. */
export { jourDansFuseau }
