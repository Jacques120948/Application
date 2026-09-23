import type { Prisma } from '@prisma/client'
import { getEntitlements } from '@/server/billing/entitlements'
import { withUserScope } from '@/server/db/scope'
import { jourDansFuseau } from '@/server/ads/metriques'
import { SHOPIFY_FEATURE } from '@/server/commerce/boutique'
import {
  frapperJeton,
  lireAcces,
  lireCommandes,
  lireCouts,
  lirePortees,
  lireReglagesBoutique,
} from '@/server/integrations/providers/shopify'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'
import { agregerCommandes, instantaneClients, type InstantaneClients } from './agregat'

/**
 * La collecte des ventes : Shopify vers Evoliia, une fois, puis relu gratuitement.
 *
 * Nova ne rappelle pas Shopify à chaque ouverture. Une synchronisation lit les commandes,
 * les réduit à des totaux par jour, et les écrit ; l'écran relit ces totaux autant qu'on
 * veut. Trois règles de rythme, et chacune répond à un coût.
 *
 * **Fraîche douze heures.** À l'ouverture, Nova ne relance une lecture que si la dernière a
 * plus de douze heures. Les ventes d'hier ne changent plus guère ; celles d'aujourd'hui se
 * rafraîchissent d'un clic.
 *
 * **Une lecture ratée ne se répète pas en boucle.** Après un échec, la lecture automatique
 * attend trente minutes. Une boutique qui refuse l'accès refuserait la minute suivante, et
 * chaque essai consomme le débit que Shopify accorde à la boutique.
 *
 * **Une panne ne vide pas l'écran.** Si Shopify ne répond pas, les jours déjà relevés
 * restent, et l'écran dit de quand ils datent.
 *
 * La première lecture remonte cent quatre-vingts jours — la plus longue période affichée,
 * quatre-vingt-dix jours finissant hier, plus les quatre-vingt-dix qu'on lui compare. Les suivantes relisent depuis la
 * dernière réussite moins trois jours, pour rattraper les remboursements et les commandes
 * modifiées. Le bouton « Actualiser » relit toute la fenêtre.
 */

export const SOURCE_SHOPIFY = 'shopify'

/** Au-delà, les ventes sont relues à l'ouverture de Nova. */
export const FRAICHEUR_MS = 12 * 60 * 60 * 1000
/** Après un échec, la lecture automatique attend. */
const PAUSE_APRES_ECHEC_MS = 30 * 60 * 1000
/** Entre deux actualisations manuelles : de quoi éviter le double clic, pas plus. */
const PAUSE_MANUELLE_MS = 2 * 60 * 1000
/**
 * La profondeur d'une lecture complète, en jours avant aujourd'hui.
 *
 * Quatre-vingt-dix jours finissant hier, et les quatre-vingt-dix qui les précèdent pour la
 * comparaison. Une fenêtre de « 90 jours aujourd'hui compris » manquait d'un jour à la
 * période de 90 jours, et entièrement à sa comparaison : l'écran affichait des tirets.
 */
export const JOURS_LUS = 180
/** La fenêtre sur laquelle se comptent les clients : la plus longue période affichée. */
const JOURS_CLIENTS = 90
/** Ce qu'une lecture partielle relit avant la dernière réussite. */
const JOURS_RATTRAPES = 3
/** Sans l'autorisation read_all_orders, Shopify ne rend que les soixante derniers jours. */
const JOURS_SANS_HISTORIQUE = 60
/** Au-delà, la lecture automatique relit toute la fenêtre pour refaire le compte des clients. */
const CLIENTS_VALABLES_MS = 7 * 24 * 60 * 60 * 1000
/** Ce qu'on garde en base. Au-delà, une comparaison d'une année sur l'autre n'est plus possible. */
const JOURS_GARDES = 400

const JOUR_MS = 24 * 60 * 60 * 1000

export type EtatVentes = {
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
  /** La dernière lecture des coûts produits : combien de variantes ont un coût, ou ce qui l'a empêchée. */
  couts: EtatCouts
}

export type EtatCouts = { at: Date | null; message: string; variantes: number; renseignes: number }

const COUTS_VIDES: EtatCouts = { at: null, message: '', variantes: 0, renseignes: 0 }

/** L'instantané relu en base, vérifié champ par champ : un JSON n'est pas une promesse. */
export function lireInstantane(brut: unknown): InstantaneClients | null {
  if (brut === null || typeof brut !== 'object') return null
  const valeur = brut as Partial<Record<keyof InstantaneClients, unknown>>
  const nombres = ['clients', 'recurrents', 'commandes', 'chiffreCents'] as const
  if (typeof valeur.au !== 'string' || typeof valeur.depuis !== 'string') return null
  if (!nombres.every((cle) => typeof valeur[cle] === 'number')) return null
  return valeur as InstantaneClients
}

const ABSENT: EtatVentes = {
  etat: 'absent',
  message: '',
  boutique: '',
  synchroAt: null,
  couvertureDepuis: null,
  tronque: false,
  devise: '',
  fuseau: '',
  clients: null,
  couts: COUTS_VIDES,
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** L'état des ventes tel qu'il est en base, sans rien demander à Shopify. */
export async function lireEtatVentes(userId: string): Promise<EtatVentes> {
  const connexion = await useCredential(userId, 'shopify').catch(() => null)
  if (connexion === null) return ABSENT
  const droits = await getEntitlements(userId)
  if (!droits.granted.includes(SHOPIFY_FEATURE)) return { ...ABSENT, etat: 'offre' }
  const acces = lireAcces(connexion.secret)
  if (acces === null) return { ...ABSENT, etat: 'erreur', message: 'Votre connexion Shopify est abîmée. Reconnectez-la.' }

  const ligne = await withUserScope(userId, (tx) =>
    tx.commerceSynchro.findUnique({
      where: { userId_source_boutique: { userId, source: SOURCE_SHOPIFY, boutique: acces.boutique } },
    }),
  )
  if (ligne === null) return { ...ABSENT, etat: 'jamais', boutique: acces.boutique }
  return {
    etat: ligne.etat as EtatVentes['etat'],
    message: ligne.message,
    boutique: ligne.boutique,
    synchroAt: ligne.synchroAt,
    couvertureDepuis: ligne.couvertureDepuis === null ? null : jourIso(ligne.couvertureDepuis),
    tronque: ligne.tronque,
    devise: ligne.devise,
    fuseau: ligne.fuseau,
    clients: lireInstantane(ligne.clients),
    couts: { at: ligne.coutsAt, message: ligne.coutsMessage, variantes: ligne.coutsVariantes, renseignes: ligne.coutsRenseignes },
  }
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

async function noter(
  userId: string,
  boutique: string,
  data: Omit<Prisma.CommerceSynchroUncheckedCreateInput, 'userId' | 'source' | 'boutique'>,
): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.commerceSynchro.upsert({
      where: { userId_source_boutique: { userId, source: SOURCE_SHOPIFY, boutique } },
      create: { userId, source: SOURCE_SHOPIFY, boutique, ...data },
      update: data,
    }),
  )
}

/**
 * Synchronise les ventes, si c'est utile.
 *
 * `auto` : à l'ouverture de l'écran, seulement si les données ont vieilli. `manuel` : le
 * bouton « Actualiser », qui relit toute la fenêtre. Ne lève jamais : une panne se note et se
 * dit, elle ne fait pas tomber Nova.
 */
export async function synchroniserVentes(
  userId: string,
  mode: 'auto' | 'manuel',
  maintenant = new Date(),
): Promise<EtatVentes> {
  const connexion = await useCredential(userId, 'shopify').catch(() => null)
  if (connexion === null) return ABSENT
  const droits = await getEntitlements(userId)
  if (!droits.granted.includes(SHOPIFY_FEATURE)) return { ...ABSENT, etat: 'offre' }
  const acces = lireAcces(connexion.secret)
  if (acces === null) return { ...ABSENT, etat: 'erreur', message: 'Votre connexion Shopify est abîmée. Reconnectez-la.' }

  const precedente = await withUserScope(userId, (tx) =>
    tx.commerceSynchro.findUnique({
      where: { userId_source_boutique: { userId, source: SOURCE_SHOPIFY, boutique: acces.boutique } },
    }),
  )
  if (mode === 'auto') {
    const relire = aRelire(
      {
        etat: (precedente?.etat ?? 'jamais') as EtatVentes['etat'],
        synchroAt: precedente?.synchroAt ?? null,
        essaiAt: precedente?.essaiAt ?? null,
      },
      maintenant,
    )
    if (!relire) return lireEtatVentes(userId)
  } else if (precedente?.essaiAt != null && +maintenant - +precedente.essaiAt < PAUSE_MANUELLE_MS) {
    return lireEtatVentes(userId)
  }

  await noter(userId, acces.boutique, { essaiAt: maintenant })

  try {
    const frappe = await frapperJeton(acces)
    if (!frappe.ok) {
      await markConnectionError(userId, connexion.connectionId, frappe.raison)
      await noter(userId, acces.boutique, { etat: 'erreur', message: frappe.raison })
      return lireEtatVentes(userId)
    }

    const portees = await lirePortees(acces, frappe.jeton)
    if (portees !== null && !portees.includes('read_orders')) {
      await noter(userId, acces.boutique, {
        etat: 'portee',
        message:
          'L’autorisation « read_orders » manque à votre application Shopify. Ajoutez-la dans le Dev Dashboard (onglet « Versions »), publiez la version, puis actualisez.',
      })
      return lireEtatVentes(userId)
    }

    const reglages = await lireReglagesBoutique(acces, frappe.jeton)
    const fuseau = reglages?.fuseau ?? precedente?.fuseau ?? ''
    const aujourdhui = jourDansFuseau(maintenant, fuseau)
    const debutFenetre = jourIso(new Date(Date.parse(aujourdhui) - JOURS_LUS * JOUR_MS))
    const derniereReussite = precedente?.synchroAt ?? null
    const instantane = lireInstantane(precedente?.clients ?? null)
    /*
     * Une lecture complète chaque semaine au moins : le compte des clients distincts ne se
     * refait que sur toute la fenêtre, jamais sur trois jours relus.
     */
    const clientsPerimes = instantane === null || +maintenant - Date.parse(instantane.au) > CLIENTS_VALABLES_MS
    /*
     * Première lecture depuis que Nova lit les coûts : toute la fenêtre est relue, sans quoi
     * les jours anciens resteraient sans coût et la marge ne se calculerait sur aucune période.
     */
    const coutsJamaisLus = precedente?.coutsAt == null
    const complete = mode === 'manuel' || derniereReussite === null || clientsPerimes || coutsJamaisLus
    const depuis =
      derniereReussite === null || complete
        ? debutFenetre
        : [debutFenetre, jourIso(new Date(+derniereReussite - JOURS_RATTRAPES * JOUR_MS))].sort().at(-1)!

    const lecture = await lireCommandes(acces, frappe.jeton, depuis)
    /*
     * Les coûts, lus à part : un refus ici ne doit rien coûter aux ventes. Les jours sont
     * alors écrits « coûts non lus », et la marge retombe sur le pourcentage saisi.
     */
    const couts = lecture.commandes.length === 0 ? null : await lireCouts(acces, frappe.jeton).catch(() => null)
    const coutsLus = couts !== null && couts.ok ? couts : null
    const jours = agregerCommandes(lecture.commandes, fuseau, coutsLus === null ? null : coutsLus.couts)

    /*
     * Ce que Shopify accepte de rendre. Sans read_all_orders, rien avant soixante jours : ce
     * qui précède n'est pas une absence de ventes, c'est une absence de lecture, et l'écran
     * doit pouvoir le distinguer.
     */
    const limite = jourIso(new Date(Date.parse(aujourdhui) - (JOURS_SANS_HISTORIQUE - 1) * JOUR_MS))
    const historique = portees?.includes('read_all_orders') === true
    const couvertureLue = historique || depuis >= limite ? depuis : limite
    const couverture = complete
      ? couvertureLue
      : precedente?.couvertureDepuis == null
        ? couvertureLue
        : jourIso(precedente.couvertureDepuis)

    /*
     * Tronquée, la lecture s'arrête avant la fin de la période : les jours qu'elle n'a pas
     * atteints ne sont pas effacés, ils gardent leur dernière valeur connue.
     */
    const dernierLu = lecture.tronque ? (jours.at(-1)?.jour ?? depuis) : null
    await withUserScope(userId, async (tx) => {
      await tx.commerceJour.deleteMany({
        where: {
          userId,
          source: SOURCE_SHOPIFY,
          boutique: acces.boutique,
          jour: { gte: new Date(depuis), ...(dernierLu === null ? {} : { lte: new Date(dernierLu) }) },
        },
      })
      if (jours.length > 0) {
        await tx.commerceJour.createMany({
          data: jours.map((jour) => ({
            userId,
            source: SOURCE_SHOPIFY,
            boutique: acces.boutique,
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

    // Le compte des clients : seulement sur une lecture complète, et seulement si Shopify a rendu les clients.
    const clients =
      complete && lecture.client && !lecture.tronque
        ? (() => {
            const debutClients = jourIso(new Date(Date.parse(aujourdhui) - JOURS_CLIENTS * JOUR_MS))
            const recentes = lecture.commandes.filter((commande) => commande.creeLe.slice(0, 10) >= debutClients)
            return instantaneClients(recentes, [debutClients, depuis].sort().at(-1)!, aujourdhui)
          })()
        : null
    await noter(userId, acces.boutique, {
      ...(clients === null ? {} : { clients: clients as unknown as Prisma.InputJsonValue }),
      ...(lecture.commandes.length === 0
        ? {}
        : {
            coutsAt: maintenant,
            coutsMessage: couts === null ? 'Shopify n’a pas rendu le coût des produits.' : couts.ok ? '' : couts.raison.slice(0, 300),
            coutsVariantes: coutsLus?.variantes ?? 0,
            coutsRenseignes: coutsLus?.couts.size ?? 0,
          }),
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      couvertureDepuis: new Date(couverture),
      tronque: lecture.tronque,
      devise: reglages?.devise ?? jours[0]?.devise ?? precedente?.devise ?? '',
      fuseau,
    })
    logger.info('ventes synchronisées', { jours: jours.length, commandes: lecture.commandes.length, complete })
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'Shopify n’a pas répondu.'
    // Le message vient du connecteur, écrit pour la personne et sans fragment d'identifiant.
    await noter(userId, acces.boutique, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('synchronisation des ventes en échec', { userId })
  }
  return lireEtatVentes(userId)
}
