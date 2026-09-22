import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { classer } from '@/server/audit/intentions'
import { accesCompteActif, compteActif } from './comptes'
import { googleAds } from './google-ads'
import { LANGUES } from './mots-cles'
import { fenetre } from './metriques'

/**
 * Ce que contiennent les campagnes, et ce que les gens ont tapé pour y arriver.
 *
 * La moitié manquante de Naya. Elle savait ce qu'une campagne dépense et ce qu'elle
 * rapporte ; elle ne savait pas ce qu'elle *dit*. On n'améliore pas des composants qu'on n'a
 * pas lus, et proposer un titre sans connaître les quinze qui existent revient à proposer le
 * seizième doublon.
 *
 * Trois décisions.
 *
 * **Le créatif se relit une fois par semaine, pas chaque nuit.** Les dépenses changent tous
 * les jours ; les titres d'une annonce changent une fois par trimestre. Trois appels de plus
 * par compte et par nuit, sur un plafond partagé par tous les utilisateurs d'Evoliia, pour
 * apprendre chaque fois la même chose : c'est exactement la dépense qu'il faut refuser.
 *
 * **Les termes sont une photographie, pas un historique.** Ils sont réécrits à chaque
 * lecture. Ce qui intéresse est ce que les gens tapent en ce moment ; garder trente versions
 * du même terme ferait une table énorme dont personne ne lirait jamais les vieilles lignes.
 *
 * **Une Performance Max ne rend pas ses termes, et c'est dit.** Google ne livre pour elle que
 * des catégories agrégées. Une campagne sans terme n'est pas une campagne sans demande, et
 * l'écran doit faire la différence plutôt que de laisser conclure.
 */

/** Le créatif se relit à ce rythme. Une semaine : il ne bouge pas plus vite. */
/**
 * Les constantes de langue de Google vers les codes qu'on écrit partout ailleurs.
 *
 * L'inverse de `LANGUES` dans `mots-cles.ts`, construit une fois plutôt que parcouru : une
 * campagne dont la langue n'est pas dans cette table reste sans langue connue, ce qui est
 * plus honnête que de ranger de l'ukrainien sous « autre ».
 */
const CODES_LANGUE: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUES).map(([code, langue]) => [langue.code, code]),
)

export const FRAICHEUR_CREA_MS = 7 * 24 * 60 * 60 * 1000

/** La fenêtre des termes de recherche. Trente jours : assez pour que la traîne compte. */
export const JOURS_TERMES = 30

/** Les termes prêts à écrire. Hors transaction : le classement d'intention est du calcul. */
function creatifTermes(
  termes: readonly { campagneId: string; terme: string; impressions: number; clics: number; conversions: number; coutMicros: number }[],
  parIdentifiant: Map<string, string>,
  userId: string,
  accountId: string,
  maintenant: Date,
) {
  const lignes = []
  for (const terme of termes) {
    const campagneId = parIdentifiant.get(terme.campagneId)
    if (campagneId === undefined || terme.terme === '') continue
    lignes.push({
      userId,
      accountId,
      campagneId,
      terme: terme.terme,
      impressions: BigInt(Math.round(terme.impressions)),
      clics: BigInt(Math.round(terme.clics)),
      conversions: terme.conversions,
      coutMicros: BigInt(Math.round(terme.coutMicros)),
      // Classé par le même code que le référencement : un achat est un achat des deux côtés.
      intention: classer(terme.terme),
      vueAt: maintenant,
    })
  }
  return lignes
}

export type BilanCreatif = {
  groupes: number
  elements: number
  termes: number
  /** Appels réellement faits chez Google : c'est ce qui se compare au plafond partagé. */
  appels: number
}

/**
 * Lit les contenants, leurs morceaux et les termes de recherche du compte suivi.
 *
 * Ne lève pas : un refus est une valeur de retour, parce que cette fonction est appelée dans
 * une boucle nocturne qui ne doit pas s'interrompre.
 */
export async function synchroniserCreatif(
  userId: string,
  maintenant = new Date(),
): Promise<{ ok: true; bilan: BilanCreatif } | { ok: false; raison: string }> {
  const ouverture = await accesCompteActif(userId)
  if (!ouverture.ok) return ouverture
  const { acces, compte } = ouverture

  const debut = new Date(maintenant.getTime())
  const bilan: BilanCreatif = { groupes: 0, elements: 0, termes: 0, appels: 0 }

  /*
   * Les campagnes déjà connues, par leur identifiant Google. Un contenant dont la campagne
   * n'est pas encore en base n'aurait nulle part où se rattacher : on le laisse tomber
   * plutôt que d'inventer une campagne à partir d'un numéro sans nom ni type.
   */
  const campagnes = await withUserScope(userId, (tx) =>
    tx.adsCampagne.findMany({
      where: { userId, accountId: compte.id },
      select: { id: true, campagneId: true },
    }),
  )
  const parIdentifiant = new Map(campagnes.map((une) => [une.campagneId, une.id]))

  const creatif = await googleAds.lireCreatif(acces)
  bilan.appels += 3
  if (!creatif.ok) return creatif

  /*
   * Tout ce qui suit est écrit par lots, et ce n'est pas une optimisation de confort : une
   * transaction cloisonnée par élément ouvre une portée, pose la variable de session et
   * ferme — trois allers-retours pour un titre. Une Performance Max en porte des centaines,
   * et la première lecture réelle a dépassé le temps alloué à la requête. Le nombre de
   * morceaux ne doit pas décider du nombre de transactions.
   */
  const groupesEnBase = await withUserScope(userId, async (tx) => {
    const carte = new Map<string, string>()
    for (const groupe of creatif.valeur.groupes) {
      const campagneId = parIdentifiant.get(groupe.campagneId)
      if (campagneId === undefined) continue
      const ligne = await tx.adsGroupe.upsert({
        where: { accountId_groupeId: { accountId: compte.id, groupeId: groupe.groupeId } },
        create: {
          userId,
          accountId: compte.id,
          campagneId,
          groupeId: groupe.groupeId,
          nom: groupe.nom,
          genre: groupe.genre,
          statut: groupe.statut,
          vueAt: maintenant,
        },
        update: {
          campagneId,
          nom: groupe.nom,
          genre: groupe.genre,
          statut: groupe.statut,
          vueAt: maintenant,
        },
        select: { id: true },
      })
      carte.set(groupe.groupeId, ligne.id)
      bilan.groupes += 1
    }
    return carte
  })

  /*
   * Les morceaux se comparent en mémoire avant d'écrire : les nouveaux sont créés en une
   * fois, ceux qui ont disparu sont supprimés en une fois, et les autres ne sont touchés
   * que si leur note a changé. Trois requêtes au lieu de plusieurs centaines.
   *
   * `origine` n'est jamais réécrit : un titre déposé par Evoliia et relu chez Google reste
   * un titre d'Evoliia. L'écraser effacerait la seule mesure de ce que Naya a apporté.
   */
  const attendus = new Map<
    string,
    { groupeId: string; champ: string; texte: string; elementId: string; performance: string }
  >()
  for (const element of creatif.valeur.elements) {
    const groupeId = groupesEnBase.get(element.groupeId)
    if (groupeId === undefined) continue
    attendus.set(`${groupeId}::${element.champ}::${element.texte}`, {
      groupeId,
      champ: element.champ,
      texte: element.texte,
      elementId: element.elementId,
      performance: element.performance,
    })
  }
  bilan.elements = attendus.size

  await withUserScope(userId, async (tx) => {
    const existants = await tx.adsElement.findMany({
      where: { userId, accountId: compte.id },
      select: { id: true, groupeId: true, champ: true, texte: true, performance: true },
    })

    const connus = new Set<string>()
    const perimes: string[] = []
    for (const ligne of existants) {
      const cle = `${ligne.groupeId}::${ligne.champ}::${ligne.texte}`
      const attendu = attendus.get(cle)
      if (attendu === undefined) {
        perimes.push(ligne.id)
        continue
      }
      connus.add(cle)
      if (attendu.performance !== ligne.performance) {
        await tx.adsElement.updateMany({
          where: { id: ligne.id, userId },
          data: { performance: attendu.performance, elementId: attendu.elementId, vueAt: maintenant },
        })
      }
    }

    const nouveaux = [...attendus.entries()]
      .filter(([cle]) => !connus.has(cle))
      .map(([, element]) => ({
        userId,
        accountId: compte.id,
        groupeId: element.groupeId,
        champ: element.champ,
        texte: element.texte,
        elementId: element.elementId,
        performance: element.performance,
        vueAt: maintenant,
      }))
    if (nouveaux.length > 0) {
      await tx.adsElement.createMany({ data: nouveaux, skipDuplicates: true })
    }

    /*
     * Supprimé plutôt que marqué : un titre retiré d'une annonce n'a pas d'histoire à
     * raconter, et le garder ferait proposer des améliorations à un texte qui ne diffuse
     * plus.
     */
    if (perimes.length > 0) {
      await tx.adsElement.deleteMany({ where: { id: { in: perimes }, userId } })
    }
  })

  await withUserScope(userId, (tx) =>
    tx.adsGroupe.deleteMany({ where: { userId, accountId: compte.id, vueAt: { lt: debut } } }),
  )

  /*
   * La langue de chaque campagne, telle qu'elle la déclare à Google. Son échec n'annule
   * rien : sans elle, la rédaction retombera sur la langue du site, ce qui est un repli
   * connu et non une panne.
   */
  const langues = await googleAds.lireLanguesDesCampagnes(acces)
  bilan.appels += 1
  if (langues.ok) {
    await withUserScope(userId, async (tx) => {
      for (const [identifiant, langue] of Object.entries(langues.valeur)) {
        const code = CODES_LANGUE[langue]
        if (code === undefined) continue
        await tx.adsCampagne.updateMany({
          where: { userId, accountId: compte.id, campagneId: identifiant },
          data: { langue: code },
        })
      }
    })
  }

  const bornes = fenetre(JOURS_TERMES, compte.fuseau, maintenant)
  const termes = await googleAds.lireTermes(acces, bornes.depuis, bornes.jusqua)
  bilan.appels += 1

  /*
   * Un échec sur les termes n'annule pas la lecture du créatif : ce sont deux informations
   * distinctes, et perdre l'une parce que l'autre a échoué ferait deux pannes d'une seule.
   */
  if (termes.ok) {
    /*
     * Les termes sont une photographie, pas un historique : on remplace tout plutôt que de
     * rapprocher ligne à ligne. Deux requêtes, quel que soit le nombre de termes.
     */
    const lignes = creatifTermes(termes.valeur, parIdentifiant, userId, compte.id, maintenant)
    bilan.termes = lignes.length
    await withUserScope(userId, async (tx) => {
      await tx.adsTerme.deleteMany({ where: { userId, accountId: compte.id } })
      if (lignes.length > 0) await tx.adsTerme.createMany({ data: lignes, skipDuplicates: true })
    })
  }

  await withUserScope(userId, (tx) =>
    tx.adsAccount.updateMany({ where: { id: compte.id, userId }, data: { creaAt: maintenant } }),
  )

  logger.info('créatif publicitaire lu', { ...bilan, termesLus: termes.ok })
  return { ok: true, bilan }
}

/**
 * La tournée du créatif, pour les comptes dont la lecture date.
 *
 * Elle suit la lecture des dépenses et ne s'y substitue pas. Le filtre de fraîcheur est la
 * seule chose qui la rende supportable : sans lui, elle multiplierait par deux et demi la
 * consommation du plafond partagé pour une information qui ne bouge pas.
 */
export async function synchroniserCreatifs(limite = 20): Promise<{
  comptes: number
  groupes: number
  termes: number
  appels: number
  echecs: number
}> {
  const total = { comptes: 0, groupes: 0, termes: 0, appels: 0, echecs: 0 }

  /*
   * Par les utilisateurs, puis par la portée de chacun. `AdsAccount` est sous Row Level
   * Security forcé : une lecture faite hors portée ne lève pas d'erreur, elle rend zéro
   * ligne — et la tournée se déclarerait passée sans avoir rien lu.
   */
  const utilisateurs = await prisma.user.findMany({
    where: { disabledAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  })

  const limiteFraicheur = new Date(Date.now() - FRAICHEUR_CREA_MS)
  for (const utilisateur of utilisateurs) {
    if (total.comptes >= limite) break
    const aFaire = await withUserScope(utilisateur.id, (tx) =>
      tx.adsAccount.count({
        where: {
          userId: utilisateur.id,
          actif: true,
          synchroAt: { not: null },
          OR: [{ creaAt: null }, { creaAt: { lt: limiteFraicheur } }],
        },
      }),
    )
    if (aFaire === 0) continue

    total.comptes += 1
    try {
      const issue = await synchroniserCreatif(utilisateur.id)
      if (!issue.ok) {
        total.echecs += 1
        continue
      }
      total.groupes += issue.bilan.groupes
      total.termes += issue.bilan.termes
      total.appels += issue.bilan.appels
    } catch (error) {
      total.echecs += 1
      // Ni jeton, ni identifiant de compte : un journal se relit, se copie et s'exporte.
      logger.warn('lecture du créatif échouée', {
        raison: error instanceof Error ? error.message.slice(0, 120) : 'inconnu',
      })
    }
  }

  logger.info('tournée du créatif passée', { ...total })
  return total
}

/** Un contenant et ses morceaux, prêts pour l'écran. */
export type GroupeVu = {
  id: string
  nom: string
  genre: string
  statut: string
  campagne: string
  typeCampagne: string
  titres: ElementVu[]
  titresLongs: ElementVu[]
  descriptions: ElementVu[]
  images: ElementVu[]
  /** Ce que le contenant cible. Ne compte jamais dans le remplissage. */
  motsCles: string[]
}

export type ElementVu = {
  id: string
  texte: string
  performance: string
  origine: string
}

export type TermeVu = {
  terme: string
  campagne: string
  impressions: number
  clics: number
  conversions: number
  cout: number
  intention: string
}

/** Au-delà, la traîne est faite de requêtes vues une fois, qui n'apprennent rien. */
const TERMES_MAX = 60

/** Ce que contiennent les campagnes du compte suivi, et ce que les gens ont tapé. */
export async function lireCreatifDuCompte(userId: string): Promise<{
  groupes: GroupeVu[]
  termes: TermeVu[]
  /** Faux tant qu'aucune lecture du créatif n'a eu lieu : l'écran doit le dire. */
  lu: boolean
  luAt: Date | null
} | null> {
  const compte = await compteActif(userId)
  if (compte === null) return null

  const groupes = await withUserScope(userId, (tx) =>
    tx.adsGroupe.findMany({
      where: { userId, accountId: compte.id },
      orderBy: [{ genre: 'asc' }, { nom: 'asc' }],
      select: {
        id: true,
        nom: true,
        genre: true,
        statut: true,
        campagne: { select: { nom: true, type: true } },
        elements: {
          orderBy: [{ champ: 'asc' }, { texte: 'asc' }],
          select: { id: true, champ: true, texte: true, performance: true, origine: true },
        },
      },
    }),
  )

  const termes = await withUserScope(userId, (tx) =>
    tx.adsTerme.findMany({
      where: { userId, accountId: compte.id },
      orderBy: [{ conversions: 'desc' }, { impressions: 'desc' }],
      take: TERMES_MAX,
      select: {
        terme: true,
        impressions: true,
        clics: true,
        conversions: true,
        coutMicros: true,
        intention: true,
        campagne: { select: { nom: true } },
      },
    }),
  )

  const morceaux = (
    elements: Array<{
      id: string
      champ: string
      texte: string
      performance: string
      origine: string
    }>,
    champ: string,
  ): ElementVu[] =>
    elements
      .filter((element) => element.champ === champ)
      .map((element) => ({
        id: element.id,
        texte: element.texte,
        performance: element.performance,
        origine: element.origine,
      }))

  return {
    lu: compte.creaAt !== null,
    luAt: compte.creaAt,
    groupes: groupes.map((groupe) => ({
      id: groupe.id,
      nom: groupe.nom,
      genre: groupe.genre,
      statut: groupe.statut,
      campagne: groupe.campagne.nom,
      typeCampagne: groupe.campagne.type,
      titres: morceaux(groupe.elements, 'titre'),
      titresLongs: morceaux(groupe.elements, 'titre-long'),
      descriptions: morceaux(groupe.elements, 'description'),
      images: morceaux(groupe.elements, 'image'),
      motsCles: morceaux(groupe.elements, 'mot-cle').map((element) => element.texte),
    })),
    termes: termes.map((terme) => ({
      terme: terme.terme,
      campagne: terme.campagne.nom,
      impressions: Number(terme.impressions),
      clics: Number(terme.clics),
      conversions: terme.conversions,
      cout: Number(terme.coutMicros) / 1_000_000,
      intention: terme.intention,
    })),
  }
}
