import type { Prisma } from '@prisma/client'
import { jourDansFuseau } from '@/server/ads/metriques'
import { withUserScope } from '@/server/db/scope'
import { lireAbonnements, lireEncaissements } from '@/server/integrations/providers/stripe-lecture'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'
import { agregerCommandes } from './agregat'
import { calculerAbonnements, lireInstantaneAbonnements, type InstantaneAbonnements } from './abonnements'
import {
  ABSENT,
  aLireMaintenant,
  aRelire,
  ecrireJours,
  etatEnBase,
  JOUR_MS,
  JOURS_LUS,
  JOURS_RATTRAPES,
  jourIso,
  noterSynchro,
  PAUSE_MANUELLE_MS,
  type EtatVentes,
} from './collecte-commerce'
import { FOURNISSEUR_SOURCE } from './sources'

/**
 * Stripe pour Nova : deux lectures, avec les mêmes règles de rythme que les boutiques.
 *
 * **Les encaissements** : les paiements réussis, remboursements déduits, rangés par jour.
 * Ils ne font référence que sans boutique reliée — une boutique qui encaisse par Stripe
 * verrait sinon chaque vente comptée deux fois. Pas de produit, pas de canal : Stripe ne sait
 * pas d'où vient un client.
 *
 * **Les abonnements** : toute la liste, réduite à un instantané (MRR, série de treize mois,
 * cohortes). Lus dès que Stripe est relié, boutique ou non.
 *
 * Le fuseau : Stripe ne le donne pas à une clé restreinte. Les journées sont découpées dans
 * celui de Zurich, et une vente à minuit peut tomber sur la veille.
 */

const SOURCE = 'stripe' as const
/** Une seule « boutique » Stripe par personne : le compte de la clé. */
const BOUTIQUE = 'stripe'
const FUSEAU = 'Europe/Zurich'
const ABSENT_STRIPE: EtatVentes = { ...ABSENT, source: SOURCE, nom: 'Stripe' }

export async function lireEtatEncaissements(userId: string): Promise<EtatVentes> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.stripe).catch(() => null)
  if (connexion === null) return ABSENT_STRIPE
  return etatEnBase(userId, SOURCE, BOUTIQUE)
}

export async function synchroniserEncaissements(userId: string, mode: 'auto' | 'manuel', maintenant = new Date()): Promise<EtatVentes> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.stripe).catch(() => null)
  if (connexion === null) return ABSENT_STRIPE
  const { lire, precedente } = await aLireMaintenant(userId, SOURCE, BOUTIQUE, mode, maintenant)
  if (!lire) return lireEtatEncaissements(userId)
  await noterSynchro(userId, SOURCE, BOUTIQUE, { essaiAt: maintenant })
  try {
    const aujourdhui = jourDansFuseau(maintenant, FUSEAU)
    const debutFenetre = jourIso(new Date(Date.parse(aujourdhui) - JOURS_LUS * JOUR_MS))
    const derniere = precedente?.synchroAt ?? null
    const complete = mode === 'manuel' || derniere === null
    const depuis = complete ? debutFenetre : [debutFenetre, jourIso(new Date(+derniere - JOURS_RATTRAPES * JOUR_MS))].sort().at(-1)!
    const lecture = await lireEncaissements(connexion.secret, depuis)
    if (!lecture.ok) {
      await markConnectionError(userId, connexion.connectionId, lecture.raison)
      await noterSynchro(userId, SOURCE, BOUTIQUE, { etat: 'erreur', message: lecture.raison.slice(0, 300) })
      return lireEtatEncaissements(userId)
    }
    const jours = agregerCommandes(lecture.commandes, FUSEAU)
    /*
     * Stripe rend les plus récents d'abord : une lecture tronquée perd les plus anciens. La
     * couverture commence alors au lendemain du plus ancien jour lu, qui peut être incomplet.
     */
    const plusAncien = jours[0]?.jour ?? depuis
    const couvertureLue = lecture.tronque ? jourIso(new Date(Date.parse(plusAncien) + JOUR_MS)) : depuis
    await ecrireJours(userId, SOURCE, BOUTIQUE, depuis, null, jours, maintenant)
    await noterSynchro(userId, SOURCE, BOUTIQUE, {
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      couvertureDepuis: new Date(complete || precedente?.couvertureDepuis == null ? couvertureLue : jourIso(precedente.couvertureDepuis)),
      tronque: lecture.tronque,
      devise: jours.at(-1)?.devise ?? precedente?.devise ?? '',
      fuseau: FUSEAU,
    })
    logger.info('encaissements Stripe synchronisés', { jours: jours.length, paiements: lecture.commandes.length, complete })
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'Stripe n’a pas répondu.'
    await noterSynchro(userId, SOURCE, BOUTIQUE, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('synchronisation des encaissements Stripe en échec', { userId })
  }
  return lireEtatEncaissements(userId)
}

// ── Abonnements ──────────────────────────────────────────────────────────────

export type EtatAbonnements = {
  etat: 'absent' | 'jamais' | 'ok' | 'erreur'
  message: string
  synchroAt: Date | null
  tronque: boolean
  instantane: InstantaneAbonnements | null
}

const SANS_ABONNEMENTS: EtatAbonnements = { etat: 'absent', message: '', synchroAt: null, tronque: false, instantane: null }

export async function lireEtatAbonnements(userId: string): Promise<EtatAbonnements> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.stripe).catch(() => null)
  if (connexion === null) return SANS_ABONNEMENTS
  const ligne = await withUserScope(userId, (tx) => tx.abonnementsSynchro.findUnique({ where: { userId } }))
  if (ligne === null) return { ...SANS_ABONNEMENTS, etat: 'jamais' }
  return {
    etat: ligne.etat as EtatAbonnements['etat'],
    message: ligne.message,
    synchroAt: ligne.synchroAt,
    tronque: ligne.tronque,
    instantane: lireInstantaneAbonnements(ligne.instantane),
  }
}

async function noter(userId: string, data: Omit<Prisma.AbonnementsSynchroUncheckedCreateInput, 'userId'>): Promise<void> {
  await withUserScope(userId, (tx) => tx.abonnementsSynchro.upsert({ where: { userId }, create: { userId, ...data }, update: data }))
}

export async function synchroniserAbonnements(userId: string, mode: 'auto' | 'manuel', maintenant = new Date()): Promise<EtatAbonnements> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.stripe).catch(() => null)
  if (connexion === null) return SANS_ABONNEMENTS
  const precedente = await withUserScope(userId, (tx) => tx.abonnementsSynchro.findUnique({ where: { userId } }))
  const essai = precedente?.essaiAt ?? null
  const relire =
    mode === 'auto'
      ? aRelire({ etat: (precedente?.etat ?? 'jamais') as EtatVentes['etat'], synchroAt: precedente?.synchroAt ?? null, essaiAt: essai }, maintenant)
      : !(essai !== null && +maintenant - +essai < PAUSE_MANUELLE_MS)
  if (!relire) return lireEtatAbonnements(userId)
  await noter(userId, { essaiAt: maintenant })
  try {
    const lecture = await lireAbonnements(connexion.secret, maintenant)
    if (!lecture.ok) {
      await markConnectionError(userId, connexion.connectionId, lecture.raison)
      await noter(userId, { etat: 'erreur', message: lecture.raison.slice(0, 300) })
      return lireEtatAbonnements(userId)
    }
    const instantane = calculerAbonnements(lecture.abonnements, jourDansFuseau(maintenant, FUSEAU))
    await noter(userId, {
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      devise: instantane.devise,
      tronque: lecture.tronque,
      instantane: instantane as unknown as Prisma.InputJsonValue,
    })
    logger.info('abonnements Stripe synchronisés', { abonnements: lecture.abonnements.length })
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'Stripe n’a pas répondu.'
    await noter(userId, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('synchronisation des abonnements Stripe en échec', { userId })
  }
  return lireEtatAbonnements(userId)
}
