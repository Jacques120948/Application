import type { Prisma } from '@prisma/client'
import { notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { compteActif, type CompteRelie } from './comptes'
import { metaAds } from './meta-ads'
import { lireTableauMeta } from './tableau-meta'
import {
  evaluerMeta,
  type ConstatMeta,
  type NiveauCible,
  type Priorite,
  type Risque,
} from './regles-meta'

/**
 * Les constats de MIRA, et pourquoi ils cessent d'être recalculés à chaque ouverture.
 *
 * Jusqu'ici la page les recalculait à l'affichage : c'était gratuit, immédiat, et faux sur
 * trois points. Un constat écarté revenait au rechargement suivant. Un constat n'avait pas
 * d'âge — or « cette annonce fatigue depuis douze jours » ne se lit pas comme « cette
 * annonce fatigue depuis hier ». Et la liste changeait quand on changeait de période, si
 * bien qu'un problème disparaissait pour avoir choisi sept jours au lieu de quatorze.
 *
 * On range donc, avec la mécanique déjà éprouvée sur Naya, et deux différences qui tiennent
 * à Meta.
 *
 * **La clé d'un constat est la règle et la cible, pas la règle et la campagne.** Chez
 * Google, un constat vise une campagne. Chez Meta, le budget vit sur l'ensemble et la
 * fatigue sur l'annonce : deux annonces de la même campagne peuvent s'essouffler en même
 * temps, et les confondre en fermerait une à chaque passage de l'autre.
 *
 * **La fenêtre de jugement est fixe.** Quatorze jours, quelle que soit la période choisie à
 * l'écran. Le sélecteur de période sert à regarder des chiffres ; il n'a pas à faire
 * apparaître et disparaître des problèmes. Un constat qui dépend de la case cochée n'est pas
 * un constat, c'est une coïncidence.
 *
 * Le reste est repris tel quel : une seule ligne ouverte par clé, les chiffres se
 * rafraîchissent sans toucher à `createdAt`, une condition qui cesse ferme la ligne sans
 * l'effacer, et une recommandation écartée se tait un mois avant de revenir si la situation
 * persiste — se taire pour toujours serait l'autre façon de mal faire.
 *
 * Gratuit de bout en bout : aucun appel chez Meta, aucun appel à un modèle, aucun crédit.
 * Ce sont des lectures en base et des comparaisons de nombres. C'est la condition pour que
 * cela puisse tourner chaque nuit, pour tout le monde.
 */

/** Le temps pendant lequel une recommandation écartée ne revient pas. */
const SILENCE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * La fenêtre sur laquelle MIRA juge, indépendante de celle qu'on regarde.
 *
 * Quatorze jours, et le choix se discute dans les deux sens. Plus court, une mauvaise
 * semaine suffirait à condamner une annonce. Plus long, la lassitude — qui est le propre de
 * Meta et s'installe en une à deux semaines — serait noyée dans la moyenne du mois. Les
 * planchers des règles (trente unités dépensées, deux mille affichages, trois ventes) sont
 * atteignables sur quatorze jours par un petit budget ; c'est ce qui décide.
 */
const FENETRE_META = 14

export type RecommandationMetaVue = {
  id: string
  regle: string
  priorite: Priorite
  niveau: NiveauCible
  /** Le nom de l'objet visé, tel qu'il s'affiche. */
  cible: string
  /** Son identifiant interne : c'est lui que portera l'action, jamais le nom. */
  cibleId: string
  titre: string
  observation: string
  pourquoi: string
  consequence: string
  recommandation: string
  jours: number
  donnees: Record<string, unknown>
  /** L'action proposée, telle que les règles l'ont décrite. Rien ne l'exécute encore. */
  action: Record<string, unknown>
  risque: Risque
  createdAt: Date
  /** Jours écoulés depuis l'ouverture : ce qui dure ne se lit pas comme ce qui arrive. */
  age: number
}

const PRIORITES: readonly Priorite[] = ['urgent', 'surveiller', 'opportunite', 'information']
const NIVEAUX: readonly NiveauCible[] = ['campagne', 'ensemble', 'annonce']
const RISQUES: readonly Risque[] = ['faible', 'moyen', 'eleve']

/*
 * Les colonnes sont du texte libre pour la base : une ligne écrite par une version
 * antérieure peut porter une valeur qu'on ne connaît plus. On retombe alors sur la plus
 * discrète des valeurs plutôt que de laisser passer une chaîne inconnue jusqu'à l'affichage.
 */
function priorite(valeur: string): Priorite {
  return (PRIORITES as readonly string[]).includes(valeur) ? (valeur as Priorite) : 'information'
}

function niveau(valeur: string): NiveauCible {
  return (NIVEAUX as readonly string[]).includes(valeur) ? (valeur as NiveauCible) : 'campagne'
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

const JOUR_MS = 24 * 60 * 60 * 1000

/** Les constats ouverts du compte Meta suivi, les plus pressants en tête. */
export async function lireRecommandationsMeta(
  userId: string,
  accountId: string,
  maintenant = new Date(),
): Promise<RecommandationMetaVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsRecommandation.findMany({
      where: { userId, accountId, etat: 'ouverte' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        regle: true,
        priorite: true,
        niveau: true,
        cible: true,
        cibleId: true,
        titre: true,
        observation: true,
        pourquoi: true,
        consequence: true,
        recommandation: true,
        jours: true,
        donnees: true,
        action: true,
        risque: true,
        createdAt: true,
      },
    }),
  )

  return lignes
    .map((ligne) => ({
      id: ligne.id,
      regle: ligne.regle,
      priorite: priorite(ligne.priorite),
      niveau: niveau(ligne.niveau),
      cible: ligne.cible,
      cibleId: ligne.cibleId,
      titre: ligne.titre,
      observation: ligne.observation,
      pourquoi: ligne.pourquoi,
      consequence: ligne.consequence,
      recommandation: ligne.recommandation,
      jours: ligne.jours,
      donnees: (ligne.donnees ?? {}) as Record<string, unknown>,
      action: (ligne.action ?? {}) as Record<string, unknown>,
      risque: risque(ligne.risque),
      createdAt: ligne.createdAt,
      age: Math.max(0, Math.floor((+maintenant - +ligne.createdAt) / JOUR_MS)),
    }))
    .sort((a, b) => RANG[a.priorite] - RANG[b.priorite] || +a.createdAt - +b.createdAt)
}

/**
 * La clé d'unicité d'un constat : la règle, et l'objet qu'elle vise.
 *
 * Elle doit coller exactement à l'index unique partiel de la base — sinon une création que
 * ce code croit légitime se heurterait à une contrainte, et la tournée nocturne
 * s'interromprait sur une ligne. L'identifiant de cible est interne et déjà unique dans le
 * compte ; la campagne qui le porte s'en déduit, elle n'a pas à entrer dans la clé.
 */
function cleMeta(regle: string, cibleId: string): string {
  return `${regle}::${cibleId}`
}

export type BilanMeta = {
  ouvertes: number
  rafraichies: number
  fermees: number
  /** Écartées récemment, donc laissées de côté cette fois. */
  tues: number
}

/**
 * Passe les règles de MIRA sur le compte Meta suivi et range le résultat.
 *
 * Ne lève pas : elle est appelée dans une boucle nocturne qui ne doit pas s'interrompre, et
 * depuis des routes dont ce n'est pas le sujet principal.
 */
export async function evaluerCompteMeta(
  userId: string,
  maintenant = new Date(),
): Promise<{ ok: true; bilan: BilanMeta; compte: CompteRelie } | { ok: false; raison: string }> {
  const compte = await compteActif(userId, metaAds.id)
  if (compte === null) return { ok: false, raison: 'Aucun compte Meta n’est suivi.' }
  if (compte.synchroAt === null) {
    return { ok: false, raison: 'Les campagnes Meta n’ont pas encore été lues.' }
  }

  const vue = await lireTableauMeta(userId, FENETRE_META)
  const constats = evaluerMeta({ devise: compte.devise, profil: vue.profil, vue })
  const attendus = new Map(constats.map((constat) => [cleMeta(constat.regle, constat.cibleId), constat]))

  const existantes = await withUserScope(userId, (tx) =>
    tx.adsRecommandation.findMany({
      where: { userId, accountId: compte.id, etat: { in: ['ouverte', 'ignoree'] } },
      select: { id: true, regle: true, cibleId: true, etat: true, closedAt: true },
    }),
  )

  const ouvertes = new Map(
    existantes
      .filter((ligne) => ligne.etat === 'ouverte')
      .map((ligne) => [cleMeta(ligne.regle, ligne.cibleId), ligne.id]),
  )

  /*
   * Le silence des écartées. On garde la fermeture la plus récente par clé : un constat
   * écarté il y a deux jours, rouvert, puis réécarté se compte depuis la dernière fois.
   */
  const silences = new Map<string, number>()
  for (const ligne of existantes) {
    if (ligne.etat !== 'ignoree' || ligne.closedAt === null) continue
    const identifiant = cleMeta(ligne.regle, ligne.cibleId)
    silences.set(identifiant, Math.max(silences.get(identifiant) ?? 0, +ligne.closedAt))
  }

  const bilan: BilanMeta = { ouvertes: 0, rafraichies: 0, fermees: 0, tues: 0 }

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
          cibleId: constat.cibleId,
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

  logger.info('règles Meta passées', { ...bilan, constats: constats.length })
  return { ok: true, bilan, compte }
}

/**
 * Ce qu'une ligne porte du constat.
 *
 * `createdAt` n'y est pas : il ne bouge jamais, c'est la seule mesure d'ancienneté. Le nom
 * de la cible, lui, se rafraîchit comme le reste — le titre le porte déjà, et le figer ici
 * ferait dire deux noms différents à la même ligne après un renommage.
 */
function donneesDe(constat: ConstatMeta) {
  return {
    niveau: constat.niveau,
    cible: constat.cible,
    priorite: constat.priorite,
    titre: constat.titre,
    observation: constat.observation,
    pourquoi: constat.pourquoi,
    consequence: constat.consequence,
    recommandation: constat.recommandation,
    jours: constat.jours,
    donnees: constat.donnees as Prisma.InputJsonValue,
    action: constat.action as Prisma.InputJsonValue,
    risque: constat.risque,
  }
}

/** Écarte un constat de MIRA. Il reviendra dans un mois si la situation persiste. */
export async function ecarterMeta(userId: string, id: string): Promise<void> {
  const touchees = await withUserScope(userId, (tx) =>
    tx.adsRecommandation.updateMany({
      where: { id, userId, etat: 'ouverte' },
      data: { etat: 'ignoree', closedAt: new Date() },
    }),
  )
  if (touchees.count === 0) throw notFound('Ce constat est introuvable.')
}

/**
 * La tournée des règles Meta, pour tous les comptes reliés.
 *
 * Elle suit la lecture nocturne et ne coûte rien de plus : pas un appel chez Meta, pas un
 * crédit. Un compte qui échoue n'arrête pas la tournée — une autorisation révoquée ou un
 * compte jamais synchronisé sont des états ordinaires.
 */
export async function evaluerTousMeta(limite = 40): Promise<{
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
        where: {
          userId: utilisateur.id,
          plateforme: metaAds.id,
          actif: true,
          synchroAt: { not: null },
        },
      }),
    )
    if (suivis === 0) continue

    total.comptes += 1
    try {
      const issue = await evaluerCompteMeta(utilisateur.id)
      if (!issue.ok) {
        total.echecs += 1
        continue
      }
      total.ouvertes += issue.bilan.ouvertes
      total.fermees += issue.bilan.fermees
    } catch (error) {
      total.echecs += 1
      // Ni identifiant de compte ni chiffre : un journal se relit, se copie et s'exporte.
      logger.warn('évaluation Meta échouée', {
        raison: error instanceof Error ? error.message.slice(0, 120) : 'inconnu',
      })
    }
  }

  logger.info('tournée des règles Meta passée', { ...total })
  return total
}
