import type { Prisma } from '@prisma/client'
import { withUserScope } from '@/server/db/scope'
import type { CohorteClients, InstantaneClients, JourVentes as JourVentesAgregees } from './agregat'
import { NOM_SOURCE, type SourceVentes } from './sources'

/**
 * Ce que toutes les sources de ventes partagent : les rythmes de lecture, l'état en base,
 * l'écriture des journées. Shopify, WooCommerce et Stripe n'y ajoutent que leur façon de lire.
 *
 * Nova ne rappelle pas une source à chaque ouverture. Une synchronisation lit les ventes,
 * les réduit à des totaux par jour, et les écrit ; l'écran relit ces totaux autant qu'on
 * veut. Trois règles de rythme, et chacune répond à un coût.
 *
 * **Fraîche douze heures.** À l'ouverture, Nova ne relance une lecture que si la dernière a
 * plus de douze heures. Les ventes d'hier ne changent plus guère ; celles d'aujourd'hui se
 * rafraîchissent d'un clic.
 *
 * **Une lecture ratée ne se répète pas en boucle.** Après un échec, la lecture automatique
 * attend trente minutes. Une boutique qui refuse l'accès refuserait la minute suivante, et
 * chaque essai consomme le débit que la source accorde.
 *
 * **Une panne ne vide pas l'écran.** Si la source ne répond pas, les jours déjà relevés
 * restent, et l'écran dit de quand ils datent.
 *
 * La première lecture remonte cent quatre-vingts jours — la plus longue période affichée,
 * quatre-vingt-dix jours finissant hier, plus les quatre-vingt-dix qu'on lui compare. Les
 * suivantes relisent depuis la dernière réussite moins trois jours, pour rattraper les
 * remboursements et les commandes modifiées. Le bouton « Actualiser » relit toute la fenêtre.
 */

export const SOURCE_SHOPIFY: SourceVentes = 'shopify'

/** Au-delà, les ventes sont relues à l'ouverture de Nova. */
export const FRAICHEUR_MS = 12 * 60 * 60 * 1000
/** Après un échec, la lecture automatique attend. */
export const PAUSE_APRES_ECHEC_MS = 30 * 60 * 1000
/** Entre deux actualisations manuelles : de quoi éviter le double clic, pas plus. */
export const PAUSE_MANUELLE_MS = 2 * 60 * 1000
/**
 * La profondeur d'une lecture complète, en jours avant aujourd'hui.
 *
 * Quatre-vingt-dix jours finissant hier, et les quatre-vingt-dix qui les précèdent pour la
 * comparaison. Une fenêtre de « 90 jours aujourd'hui compris » manquait d'un jour à la
 * période de 90 jours, et entièrement à sa comparaison : l'écran affichait des tirets.
 */
export const JOURS_LUS = 180
/** La fenêtre sur laquelle se comptent les clients : la plus longue période affichée. */
export const JOURS_CLIENTS = 90
/** Ce qu'une lecture partielle relit avant la dernière réussite. */
export const JOURS_RATTRAPES = 3
/** Sans l'autorisation read_all_orders, Shopify ne rend que les soixante derniers jours. */
export const JOURS_SANS_HISTORIQUE = 60
/** Au-delà, la lecture automatique relit toute la fenêtre pour refaire le compte des clients. */
export const CLIENTS_VALABLES_MS = 7 * 24 * 60 * 60 * 1000
/** Ce qu'on garde en base. Au-delà, une comparaison d'une année sur l'autre n'est plus possible. */
export const JOURS_GARDES = 400

export const JOUR_MS = 24 * 60 * 60 * 1000

export type EtatVentes = {
  /** La source de ventes qui fait référence, et son nom tel qu'on le dit. */
  source: SourceVentes
  nom: string
  /**
   * absent : aucune boutique reliée. offre : l'offre n'ouvre pas la boutique. portee :
   * l'autorisation de lire les commandes manque. jamais : reliée, pas encore lue.
   */
  etat: 'absent' | 'offre' | 'jamais' | 'ok' | 'erreur' | 'portee'
  message: string
  boutique: string
  synchroAt: Date | null
  couvertureDepuis: string | null
  tronque: boolean
  devise: string
  fuseau: string
  /** Le dernier compte des clients sur la fenêtre lue, ou `null` s'il n'a pas pu être fait. */
  clients: InstantaneClients | null
  /** Les cohortes de clients à la dernière lecture complète ; `null` sans identifiant client. */
  cohortes: CohorteClients[] | null
  /** La dernière lecture des coûts produits : combien de variantes ont un coût, ou ce qui l'a empêchée. */
  couts: EtatCouts
}

export type EtatCouts = { at: Date | null; message: string; variantes: number; renseignes: number }

export const COUTS_VIDES: EtatCouts = { at: null, message: '', variantes: 0, renseignes: 0 }

/** L'instantané relu en base, vérifié champ par champ : un JSON n'est pas une promesse. */
export function lireInstantane(brut: unknown): InstantaneClients | null {
  if (brut === null || typeof brut !== 'object') return null
  const valeur = brut as Partial<Record<keyof InstantaneClients, unknown>>
  const nombres = ['clients', 'recurrents', 'commandes', 'chiffreCents'] as const
  if (typeof valeur.au !== 'string' || typeof valeur.depuis !== 'string') return null
  if (!nombres.every((cle) => typeof valeur[cle] === 'number')) return null
  return valeur as InstantaneClients
}

export const ABSENT: EtatVentes = {
  source: 'shopify',
  nom: 'Shopify',
  etat: 'absent',
  message: '',
  boutique: '',
  synchroAt: null,
  couvertureDepuis: null,
  tronque: false,
  devise: '',
  fuseau: '',
  clients: null,
  cohortes: null,
  couts: COUTS_VIDES,
}

export function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Faut-il relire à l'ouverture ? Pur, pour être testé sans horloge. */
export function aRelire(
  etat: Pick<EtatVentes, 'etat' | 'synchroAt'> & { essaiAt: Date | null },
  maintenant: Date,
): boolean {
  if (etat.etat === 'absent' || etat.etat === 'offre') return false
  if (etat.essaiAt !== null && +maintenant - +etat.essaiAt < PAUSE_APRES_ECHEC_MS && etat.etat !== 'ok') return false
  if (etat.synchroAt === null) return true
  return +maintenant - +etat.synchroAt >= FRAICHEUR_MS
}

export async function noterSynchro(
  userId: string,
  source: SourceVentes,
  boutique: string,
  data: Omit<Prisma.CommerceSynchroUncheckedCreateInput, 'userId' | 'source' | 'boutique'>,
): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.commerceSynchro.upsert({
      where: { userId_source_boutique: { userId, source, boutique } },
      create: { userId, source, boutique, ...data },
      update: data,
    }),
  )
}

/** L'état d'une source tel qu'il est en base. `null` : jamais synchronisée. */
export async function etatEnBase(userId: string, source: SourceVentes, boutique: string): Promise<EtatVentes> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.commerceSynchro.findUnique({ where: { userId_source_boutique: { userId, source, boutique } } }),
  )
  const base = { ...ABSENT, source, nom: NOM_SOURCE[source], boutique }
  if (ligne === null) return { ...base, etat: 'jamais' }
  return {
    ...base,
    etat: ligne.etat as EtatVentes['etat'],
    message: ligne.message,
    synchroAt: ligne.synchroAt,
    couvertureDepuis: ligne.couvertureDepuis === null ? null : jourIso(ligne.couvertureDepuis),
    tronque: ligne.tronque,
    devise: ligne.devise,
    fuseau: ligne.fuseau,
    clients: lireInstantane(ligne.clients),
    cohortes: Array.isArray(ligne.cohortes) ? (ligne.cohortes as unknown as CohorteClients[]) : null,
    couts: { at: ligne.coutsAt, message: ligne.coutsMessage, variantes: ligne.coutsVariantes, renseignes: ligne.coutsRenseignes },
  }
}

/**
 * Faut-il lire maintenant ? `auto` : seulement si les données ont vieilli ; `manuel` : sauf
 * double clic. La même règle pour chaque source — c'est elle qui tient les coûts.
 */
export async function aLireMaintenant(
  userId: string,
  source: SourceVentes,
  boutique: string,
  mode: 'auto' | 'manuel',
  maintenant: Date,
): Promise<{ lire: boolean; precedente: Prisma.CommerceSynchroGetPayload<object> | null }> {
  const precedente = await withUserScope(userId, (tx) =>
    tx.commerceSynchro.findUnique({ where: { userId_source_boutique: { userId, source, boutique } } }),
  )
  if (mode === 'auto') {
    const lire = aRelire(
      { etat: (precedente?.etat ?? 'jamais') as EtatVentes['etat'], synchroAt: precedente?.synchroAt ?? null, essaiAt: precedente?.essaiAt ?? null },
      maintenant,
    )
    return { lire, precedente }
  }
  return { lire: !(precedente?.essaiAt != null && +maintenant - +precedente.essaiAt < PAUSE_MANUELLE_MS), precedente }
}

/**
 * Écrit les journées lues, à la place de celles de la même fenêtre.
 *
 * Tronquée, la lecture s'arrête avant la fin de la période : les jours qu'elle n'a pas
 * atteints ne sont pas effacés, ils gardent leur dernière valeur connue (`dernierLu`).
 */
export async function ecrireJours(
  userId: string,
  source: SourceVentes,
  boutique: string,
  depuis: string,
  dernierLu: string | null,
  jours: readonly JourVentesAgregees[],
  maintenant: Date,
): Promise<void> {
  await withUserScope(userId, async (tx) => {
    await tx.commerceJour.deleteMany({
      where: {
        userId,
        source,
        boutique,
        jour: { gte: new Date(depuis), ...(dernierLu === null ? {} : { lte: new Date(dernierLu) }) },
      },
    })
    if (jours.length > 0) {
      await tx.commerceJour.createMany({
        data: jours.map((jour) => ({
          userId,
          source,
          boutique,
          jour: new Date(jour.jour),
          devise: jour.devise,
          commandes: jour.commandes,
          chiffreCents: BigInt(jour.chiffreCents),
          nouveauxClients: jour.nouveauxClients,
          chiffreNouveauxCents: BigInt(jour.chiffreNouveauxCents),
          clientsIdentifies: jour.clientsIdentifies,
          canaux: jour.canaux as Prisma.InputJsonValue,
          canauxPremier: jour.canauxPremier as Prisma.InputJsonValue,
          produits: jour.produits as unknown as Prisma.InputJsonValue,
          coutsLus: jour.coutsLus,
          lignesCents: BigInt(jour.lignesCents),
          lignesCouteesCents: BigInt(jour.lignesCouteesCents),
          coutProduitsCents: BigInt(jour.coutProduitsCents),
        })),
      })
    }
    await tx.commerceJour.deleteMany({
      where: { userId, jour: { lt: new Date(+maintenant - JOURS_GARDES * JOUR_MS) } },
    })
  })
}

