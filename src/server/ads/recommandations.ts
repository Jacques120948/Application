import type { Prisma } from '@prisma/client'
import { notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { compteActif, type CompteRelie } from './comptes'
import { objectifsDuCompte } from './profil'
import { lireTableauAds, type CampagneVue } from './tableau'
import {
  evaluer,
  HAUSSE_BUDGET,
  type Constat,
  type Priorite,
  type Risque,
  type TermeVu,
} from './regles'

/**
 * Les recommandations : leur vie, et pourquoi elles en ont une.
 *
 * Recalculer la liste à chaque ouverture de page aurait été plus simple et aurait tout cassé.
 * Une recommandation écartée doit rester écartée ; une recommandation appliquée doit pouvoir
 * être relue dans trois mois avec les chiffres qui l'ont motivée, et non avec ceux
 * d'aujourd'hui. Recalculer effacerait les deux — et la personne verrait chaque matin
 * reparaître l'avis qu'elle a refusé la veille, ce qui est la façon la plus sûre de faire
 * cesser de lire une liste.
 *
 * Quatre règles de vie.
 *
 * **Une seule ligne ouverte par règle et par campagne.** L'index partiel de la base
 * l'impose. Sans lui, une anomalie qui dure trois semaines produirait vingt et une lignes
 * identiques, et l'écran annoncerait vingt et un problèmes là où il y en a un depuis trois
 * semaines.
 *
 * **Les chiffres se rafraîchissent, la ligne reste.** Quand une condition tient toujours, on
 * réécrit l'observation avec les chiffres du jour sans toucher à `createdAt` : « ouverte
 * depuis douze jours » est une information, et la perdre à chaque nuit priverait la liste de
 * sa seule mesure d'ancienneté.
 *
 * **Une condition qui disparaît ferme la ligne.** Périmée, pas effacée : on saura qu'elle a
 * existé et quand elle a cessé.
 *
 * **Une recommandation écartée l'est pour un temps.** Si la condition persiste, la rouvrir le
 * lendemain serait harcelant. Elle revient après un mois — la situation, elle, n'a pas
 * disparu, et se taire pour toujours serait l'autre façon de mal faire.
 */

/** Le temps pendant lequel une recommandation écartée ne revient pas. */
const SILENCE_MS = 30 * 24 * 60 * 60 * 1000

/** La fenêtre de jugement. Trente jours : une conversion isolée n'y décide de rien. */
const FENETRE_LONGUE = 30

/** La fenêtre courte, pour ce qui se constate vite. */
const FENETRE_COURTE = 14

export type RecommandationVue = {
  id: string
  regle: string
  priorite: Priorite
  titre: string
  observation: string
  jours: number
  donnees: Record<string, unknown>
  explication: string
  risque: Risque
  createdAt: Date
  campagne: string | null
  /** L'action proposée, telle que les règles l'ont décrite. Vide quand il n'y en a pas. */
  action: Record<string, unknown>
}

const PRIORITES: readonly Priorite[] = ['urgent', 'surveiller', 'opportunite', 'information']
const RISQUES: readonly Risque[] = ['faible', 'moyen', 'eleve']

function priorite(valeur: string): Priorite {
  return (PRIORITES as readonly string[]).includes(valeur) ? (valeur as Priorite) : 'information'
}

function risque(valeur: string): Risque {
  return (RISQUES as readonly string[]).includes(valeur) ? (valeur as Risque) : 'faible'
}

const RANG: Record<Priorite, number> = {
  urgent: 0,
  opportunite: 1,
  surveiller: 2,
  information: 3,
}

/** Les recommandations ouvertes du compte suivi, les plus pressantes en tête. */
export async function lireRecommandations(
  userId: string,
  accountId: string,
): Promise<RecommandationVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsRecommandation.findMany({
      where: { userId, accountId, etat: 'ouverte' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        regle: true,
        priorite: true,
        titre: true,
        observation: true,
        jours: true,
        donnees: true,
        action: true,
        explication: true,
        risque: true,
        createdAt: true,
        campagne: { select: { nom: true } },
      },
    }),
  )

  return lignes
    .map((ligne) => ({
      id: ligne.id,
      regle: ligne.regle,
      priorite: priorite(ligne.priorite),
      titre: ligne.titre,
      observation: ligne.observation,
      jours: ligne.jours,
      donnees: (ligne.donnees ?? {}) as Record<string, unknown>,
      action: (ligne.action ?? {}) as Record<string, unknown>,
      explication: ligne.explication,
      risque: risque(ligne.risque),
      createdAt: ligne.createdAt,
      campagne: ligne.campagne?.nom ?? null,
    }))
    .sort((a, b) => RANG[a.priorite] - RANG[b.priorite] || +a.createdAt - +b.createdAt)
}

/**
 * Ce qu'on proposerait d'envoyer à Google pour ce constat, monté sur les chiffres du jour.
 *
 * Reconstruit ici plutôt que relu du constat, et c'est le point : une recommandation ouverte
 * il y a douze jours porte le budget qu'elle a vu ce jour-là. Proposer « passer de 15 à 18 »
 * alors que le budget est à 40 depuis serait proposer une baisse en la nommant hausse. La
 * valeur d'avant vient donc de la campagne telle qu'elle est maintenant, et le serveur la
 * revérifiera une dernière fois au moment d'écrire.
 *
 * `null` quand le constat ne propose rien, ou quand la campagne a disparu entre-temps.
 */
export type ActionProposee =
  | {
      type: 'budget'
      campagneId: string
      versMicros: number
      attenduMicros: number
      resume: string
    }
  | { type: 'statut'; campagneId: string; vers: 'PAUSED'; attendu: string; resume: string }
  | { type: 'exclusion'; campagneId: string; terme: string; resume: string }

export function proposerAction(
  recommandation: RecommandationVue,
  campagnes: readonly CampagneVue[],
  devise: string,
): ActionProposee | null {
  const action = recommandation.action
  const campagneId = typeof action.campagne === 'string' ? action.campagne : null
  if (campagneId === null) return null

  const campagne = campagnes.find((une) => une.id === campagneId)
  if (campagne === undefined) return null

  const montant = (valeur: number) =>
    `${valeur.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`

  if (action.type === 'budget') {
    if (campagne.budget <= 0) return null
    /*
     * La marche est recalculée sur le budget d'aujourd'hui, pas sur celui que la règle avait
     * vu. Reprendre le chiffre du constat ferait proposer une valeur qui ne s'accorde plus
     * avec la valeur d'avant envoyée juste à côté — et le serveur refuserait une action
     * qu'il aurait fallu simplement recalculer.
     */
    const propose = Math.round(campagne.budget * HAUSSE_BUDGET * 100) / 100
    return {
      type: 'budget',
      campagneId,
      versMicros: Math.round(propose * 1_000_000),
      attenduMicros: Math.round(campagne.budget * 1_000_000),
      resume: `Passer le budget quotidien de « ${campagne.nom} » de ${montant(campagne.budget)} à ${montant(propose)}.`,
    }
  }

  if (action.type === 'exclusion') {
    /*
     * Le terme vient du constat et non d'une relecture : c'est le mot exact que la règle a
     * vu coûter. Le retrouver dans les chiffres du jour donnerait parfois un autre mot, et
     * la personne exclurait autre chose que ce qu'elle a lu.
     */
    const terme = typeof action.terme === 'string' ? action.terme.trim() : ''
    if (terme === '') return null
    return {
      type: 'exclusion',
      campagneId,
      terme,
      resume: `Empêcher « ${campagne.nom} » de sortir sur la recherche « ${terme} ». Les autres mots-clés de la campagne ne bougent pas.`,
    }
  }

  if (action.type === 'pause') {
    if (campagne.statut !== 'ENABLED') return null
    return {
      type: 'statut',
      campagneId,
      vers: 'PAUSED',
      attendu: campagne.statut,
      resume: `Mettre « ${campagne.nom} » en pause. Elle cessera de diffuser et de dépenser.`,
    }
  }

  return null
}

/** La clé d'unicité d'un constat : la règle, et la campagne qu'elle vise. */
function cle(regle: string, campagneId: string | null): string {
  return `${regle}::${campagneId ?? 'compte'}`
}

export type BilanEvaluation = {
  ouvertes: number
  rafraichies: number
  fermees: number
  /** Écartées récemment, donc laissées de côté cette fois. */
  tues: number
}

/**
 * Passe les règles sur le compte suivi et range le résultat.
 *
 * Gratuite : aucun appel à un modèle, aucun crédit, aucune requête chez Google. Ce sont des
 * lectures en base et des comparaisons de nombres. C'est la condition pour qu'elle puisse
 * tourner chaque nuit pour tout le monde, et pour qu'on puisse la relancer après chaque
 * changement de marge sans que cela coûte quoi que ce soit à personne.
 *
 * Ne lève pas : elle est appelée dans une boucle nocturne qui ne doit pas s'interrompre, et
 * depuis des routes dont ce n'est pas le sujet principal.
 */
/**
 * Les termes de recherche du compte, rapportés à la campagne qui les a payés.
 *
 * Lus en une fois : une requête par campagne ferait huit allers-retours pour une évaluation
 * qui tourne toutes les nuits, sur tous les comptes.
 *
 * Les campagnes supprimées entre-temps sont exclues par la jointure elle-même — un terme
 * sans campagne n'a plus rien à exclure.
 */
async function termesDuCompte(userId: string, accountId: string): Promise<TermeVu[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsTerme.findMany({
      where: { userId, accountId },
      select: {
        terme: true,
        clics: true,
        conversions: true,
        coutMicros: true,
        campagne: { select: { id: true, nom: true } },
      },
    }),
  )

  return lignes.map((ligne) => ({
    campagneId: ligne.campagne.id,
    campagneNom: ligne.campagne.nom,
    terme: ligne.terme,
    clics: Number(ligne.clics),
    conversions: ligne.conversions,
    cout: Number(ligne.coutMicros) / 1_000_000,
  }))
}

export async function evaluerCompte(
  userId: string,
  maintenant = new Date(),
): Promise<{ ok: true; bilan: BilanEvaluation; compte: CompteRelie } | { ok: false; raison: string }> {
  const compte = await compteActif(userId)
  if (compte === null) return { ok: false, raison: 'Aucun compte publicitaire n’est suivi.' }
  if (compte.synchroAt === null) {
    return { ok: false, raison: 'Les campagnes n’ont pas encore été lues.' }
  }

  const longue = await lireTableauAds(userId, FENETRE_LONGUE)
  const courte = await lireTableauAds(userId, FENETRE_COURTE)
  const { profil, lecture } = await objectifsDuCompte(userId, compte, longue.total, maintenant)

  /*
   * Les termes de recherche, rapportés à la campagne qui les a payés. Ils dormaient en base
   * depuis la lecture du créatif sans qu'aucune règle ne les regarde — or c'est là que
   * l'argent fuit sur un petit budget.
   */
  const termes = await termesDuCompte(userId, compte.id)

  const constats = evaluer({
    devise: compte.devise,
    profil,
    lecture,
    longue,
    courte,
    termes,
    conversionsActives: compte.conversionsActives,
  })
  const attendus = new Map(constats.map((constat) => [cle(constat.regle, constat.campagneId), constat]))

  const existantes = await withUserScope(userId, (tx) =>
    tx.adsRecommandation.findMany({
      where: { userId, accountId: compte.id, etat: { in: ['ouverte', 'ignoree'] } },
      select: { id: true, regle: true, campagneId: true, etat: true, closedAt: true },
    }),
  )

  const ouvertes = new Map(
    existantes
      .filter((ligne) => ligne.etat === 'ouverte')
      .map((ligne) => [cle(ligne.regle, ligne.campagneId), ligne.id]),
  )

  /*
   * Le silence des écartées. On garde la plus récente fermeture par clé : une règle écartée
   * il y a deux jours puis rouverte puis réécartée doit compter depuis la dernière fois.
   */
  const silences = new Map<string, number>()
  for (const ligne of existantes) {
    if (ligne.etat !== 'ignoree' || ligne.closedAt === null) continue
    const identifiant = cle(ligne.regle, ligne.campagneId)
    silences.set(identifiant, Math.max(silences.get(identifiant) ?? 0, +ligne.closedAt))
  }

  const bilan: BilanEvaluation = { ouvertes: 0, rafraichies: 0, fermees: 0, tues: 0 }

  for (const [identifiant, constat] of attendus) {
    const deja = ouvertes.get(identifiant)
    if (deja !== undefined) {
      await withUserScope(userId, (tx) =>
        tx.adsRecommandation.updateMany({
          where: { id: deja, userId },
          data: donneesDe(constat),
        }),
      )
      bilan.rafraichies += 1
      continue
    }

    const tue = silences.get(identifiant)
    if (tue !== undefined && +maintenant - tue < SILENCE_MS) {
      bilan.tues += 1
      continue
    }

    await withUserScope(userId, (tx) =>
      tx.adsRecommandation.create({
        data: {
          userId,
          accountId: compte.id,
          campagneId: constat.campagneId,
          regle: constat.regle,
          ...donneesDe(constat),
        },
      }),
    )
    bilan.ouvertes += 1
  }

  for (const [identifiant, id] of ouvertes) {
    if (attendus.has(identifiant)) continue
    await withUserScope(userId, (tx) =>
      tx.adsRecommandation.updateMany({
        where: { id, userId },
        // Périmée, pas effacée : on saura qu'elle a existé, et quand elle a cessé.
        data: { etat: 'perimee', closedAt: maintenant },
      }),
    )
    bilan.fermees += 1
  }

  logger.info('règles publicitaires passées', { ...bilan, constats: constats.length })
  return { ok: true, bilan, compte }
}

/** Ce qu'une ligne porte du constat. `createdAt` n'y est pas : il ne bouge jamais. */
function donneesDe(constat: Constat) {
  return {
    priorite: constat.priorite,
    titre: constat.titre,
    observation: constat.observation,
    jours: constat.jours,
    donnees: constat.donnees as Prisma.InputJsonValue,
    action: constat.action as Prisma.InputJsonValue,
    risque: constat.risque,
  }
}

/** Écarte une recommandation. Elle reviendra dans un mois si la situation persiste. */
export async function ecarter(userId: string, id: string): Promise<void> {
  const touchees = await withUserScope(userId, (tx) =>
    tx.adsRecommandation.updateMany({
      where: { id, userId, etat: 'ouverte' },
      data: { etat: 'ignoree', closedAt: new Date() },
    }),
  )
  if (touchees.count === 0) throw notFound('Cette recommandation est introuvable.')
}

/**
 * La tournée des règles, pour tous les comptes reliés.
 *
 * Elle suit la lecture nocturne et ne coûte rien de plus : pas un appel chez Google, pas un
 * crédit. Un compte qui échoue n'arrête pas la tournée — une autorisation révoquée ou un
 * compte jamais synchronisé sont des états ordinaires.
 */
export async function evaluerTous(limite = 40): Promise<{
  comptes: number
  ouvertes: number
  fermees: number
  echecs: number
}> {
  const total = { comptes: 0, ouvertes: 0, fermees: 0, echecs: 0 }

  /*
   * Par les utilisateurs, puis par la portée de chacun. `AdsAccount` est sous Row Level
   * Security forcé : une lecture faite hors portée ne lève pas d'erreur, elle rend zéro
   * ligne — et la tournée se déclarerait passée sans avoir rien évalué.
   */
  const utilisateurs = await prisma.user.findMany({
    where: { disabledAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  })

  for (const utilisateur of utilisateurs) {
    if (total.comptes >= limite) break
    const suivis = await withUserScope(utilisateur.id, (tx) =>
      tx.adsAccount.count({
        where: { userId: utilisateur.id, actif: true, synchroAt: { not: null } },
      }),
    )
    if (suivis === 0) continue

    total.comptes += 1
    try {
      const issue = await evaluerCompte(utilisateur.id)
      if (!issue.ok) {
        total.echecs += 1
        continue
      }
      total.ouvertes += issue.bilan.ouvertes
      total.fermees += issue.bilan.fermees
    } catch (error) {
      total.echecs += 1
      // Ni identifiant de compte ni chiffre : un journal se relit, se copie et s'exporte.
      logger.warn('évaluation publicitaire échouée', {
        raison: error instanceof Error ? error.message.slice(0, 120) : 'inconnu',
      })
    }
  }

  logger.info('tournée des règles publicitaires passée', { ...total })
  return total
}
