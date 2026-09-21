import type { Prisma } from '@prisma/client'
import { notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { compteActif, type CompteRelie } from './comptes'
import { objectifsDuCompte } from './profil'
import { lireTableauAds } from './tableau'
import { evaluer, type Constat, type Priorite, type Risque } from './regles'

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
      explication: ligne.explication,
      risque: risque(ligne.risque),
      createdAt: ligne.createdAt,
      campagne: ligne.campagne?.nom ?? null,
    }))
    .sort((a, b) => RANG[a.priorite] - RANG[b.priorite] || +a.createdAt - +b.createdAt)
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

  const constats = evaluer({ devise: compte.devise, profil, lecture, longue, courte })
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
