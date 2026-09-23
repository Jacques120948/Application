import type { Prisma } from '@prisma/client'
import { getEntitlements } from '@/server/billing/entitlements'
import { SHOPIFY_FEATURE } from '@/server/commerce/boutique'
import { withUserScope } from '@/server/db/scope'
import { frapperJeton, lireAcces, lirePortees, type AccesShopify } from '@/server/integrations/providers/shopify'
import {
  lancerExportClients,
  lirePaniersAbandonnes,
  suivreExport,
  telechargerExport,
  type ClientShopify,
  type PanierShopify,
} from '@/server/integrations/providers/shopify-clients'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { aRelire, JOUR_MS, jourIso, PAUSE_MANUELLE_MS } from '@/server/nova/collecte-commerce'
import { logger } from '@/server/observability/logger'

/**
 * La collecte de Lina : la base clients de la boutique, relue au rythme de Nova.
 *
 * Elle se fait en deux temps, parce que Shopify prépare l'export de son côté : un premier
 * passage le lance, les suivants demandent s'il est prêt, et le dernier relit le fichier et
 * remplace l'index. Rien ici n'appelle un modèle, rien ne coûte un crédit.
 *
 * Ce qui est écrit : une ligne par client, sans rien qui dise qui il est (voir LinaClient),
 * et les paniers abandonnés réduits à des totaux. Le jeton Shopify ne quitte jamais ce
 * module et n'est jamais écrit.
 */

const SOURCE = 'shopify'
/** Un export qui n'a pas abouti en trois heures est abandonné et relancé. */
const EXPORT_PERIME_MS = 3 * 60 * 60 * 1000
/** Les paniers se lisent sur deux périodes de trente jours, pour voir s'ils augmentent. */
const JOURS_PANIERS = 30
const LIGNES_PAR_LOT = 2_000
/** Le suffixe de l'opération dit si elle lit le consentement : `|c` oui, `|s` sans. */
const AVEC_CONSENTEMENT = '|c'
const SANS_CONSENTEMENT = '|s'

export type PeriodePaniers = { nombre: number; valeurCents: number; recuperes: number; valeurRecupereeCents: number }

export type PaniersLina = {
  au: string
  jours: number
  devise: string
  courant: PeriodePaniers
  precedent: PeriodePaniers
  tronque: boolean
  erreur?: string
}

export type EtatLina = {
  etat: 'absent' | 'offre' | 'jamais' | 'en-cours' | 'ok' | 'erreur' | 'portee' | 'protegees'
  message: string
  boutique: string
  synchroAt: Date | null
  lanceAt: Date | null
  clients: number
  tronque: boolean
  consentement: boolean
  paniers: PaniersLina | null
}

const SANS: EtatLina = {
  etat: 'absent',
  message: '',
  boutique: '',
  synchroAt: null,
  lanceAt: null,
  clients: 0,
  tronque: false,
  consentement: false,
  paniers: null,
}

function lirePaniers(brut: unknown): PaniersLina | null {
  if (brut === null || typeof brut !== 'object') return null
  const valeur = brut as Partial<PaniersLina>
  return typeof valeur.au === 'string' && valeur.courant !== undefined ? (valeur as PaniersLina) : null
}

/** Les paniers en totaux, sur la période courante et la précédente. Pur. */
export function agregerPaniers(paniers: readonly PanierShopify[], maintenant: Date, tronque: boolean): PaniersLina {
  const vide = (): PeriodePaniers => ({ nombre: 0, valeurCents: 0, recuperes: 0, valeurRecupereeCents: 0 })
  const courant = vide()
  const precedent = vide()
  const limite = +maintenant - JOURS_PANIERS * JOUR_MS
  for (const panier of paniers) {
    const periode = Date.parse(panier.creeLe) >= limite ? courant : precedent
    periode.nombre += 1
    periode.valeurCents += panier.totalCents
    if (panier.recupere) {
      periode.recuperes += 1
      periode.valeurRecupereeCents += panier.totalCents
    }
  }
  return { au: maintenant.toISOString(), jours: JOURS_PANIERS, devise: paniers.find((un) => un.devise !== '')?.devise ?? '', courant, precedent, tronque }
}

async function acces(userId: string): Promise<{ etat: EtatLina } | { acces: AccesShopify; connectionId: string }> {
  const connexion = await useCredential(userId, 'shopify').catch(() => null)
  if (connexion === null) return { etat: SANS }
  const droits = await getEntitlements(userId)
  if (!droits.granted.includes(SHOPIFY_FEATURE)) return { etat: { ...SANS, etat: 'offre' } }
  const lu = lireAcces(connexion.secret)
  if (lu === null) return { etat: { ...SANS, etat: 'erreur', message: 'Votre connexion Shopify est abîmée. Reconnectez-la.' } }
  return { acces: lu, connectionId: connexion.connectionId }
}

export async function lireEtatLina(userId: string): Promise<EtatLina> {
  const lu = await acces(userId)
  if ('etat' in lu) return lu.etat
  const ligne = await withUserScope(userId, (tx) => tx.linaSynchro.findUnique({ where: { userId } }))
  if (ligne === null) return { ...SANS, etat: 'jamais', boutique: lu.acces.boutique }
  return {
    etat: ligne.etat as EtatLina['etat'],
    message: ligne.message,
    boutique: lu.acces.boutique,
    synchroAt: ligne.synchroAt,
    lanceAt: ligne.lanceAt,
    clients: ligne.clients,
    tronque: ligne.tronque,
    consentement: ligne.consentement,
    paniers: lirePaniers(ligne.paniers),
  }
}

async function noter(userId: string, data: Omit<Prisma.LinaSynchroUncheckedCreateInput, 'userId'>): Promise<void> {
  await withUserScope(userId, (tx) => tx.linaSynchro.upsert({ where: { userId }, create: { userId, ...data }, update: data }))
}

/** Remplace l'index des clients de la source. Par lots : une transaction ne doit pas s'éterniser. */
async function ecrireClients(userId: string, clients: readonly ClientShopify[]): Promise<void> {
  await withUserScope(userId, (tx) => tx.linaClient.deleteMany({ where: { userId, source: SOURCE } }))
  for (let debut = 0; debut < clients.length; debut += LIGNES_PAR_LOT) {
    const lot = clients.slice(debut, debut + LIGNES_PAR_LOT)
    await withUserScope(userId, (tx) =>
      tx.linaClient.createMany({
        data: lot.map((client) => ({
          userId,
          source: SOURCE,
          ref: client.ref,
          creeLe: new Date(client.creeLe),
          derniereCommande: client.derniereCommande === null ? null : new Date(client.derniereCommande),
          commandes: client.commandes,
          caCents: Math.min(client.caCents, 2_000_000_000),
          devise: client.devise,
          consentement: client.consentement,
        })),
        skipDuplicates: true,
      }),
    )
  }
}

const MESSAGE_PROTEGEES =
  'Shopify ne laisse pas encore Lina lire vos clients. Dans le Dev Dashboard de votre application Shopify, section « API access », demandez l’accès aux « Protected customer data » (Lina ne conserve ni nom, ni courriel, ni adresse), puis relancez l’analyse.'
const MESSAGE_PORTEE =
  'L’autorisation « read_customers » manque à votre application Shopify. Ajoutez-la dans le Dev Dashboard (onglet « Versions »), publiez la version, puis relancez l’analyse.'

/** Lance l'export, avec le consentement d'abord, sans lui si Shopify le refuse. */
async function lancer(userId: string, acces: AccesShopify, jeton: string, maintenant: Date, consentement: boolean): Promise<void> {
  const essai = await lancerExportClients(acces, jeton, consentement)
  if (essai.ok) {
    await noter(userId, {
      etat: 'en-cours',
      message: '',
      operation: `${essai.operation}${consentement ? AVEC_CONSENTEMENT : SANS_CONSENTEMENT}`,
      lanceAt: maintenant,
    })
    return
  }
  if (essai.protegees && consentement) return lancer(userId, acces, jeton, maintenant, false)
  await noter(userId, {
    etat: essai.protegees ? 'protegees' : /read_customers/u.test(essai.raison) ? 'portee' : 'erreur',
    message: essai.protegees ? MESSAGE_PROTEGEES : /read_customers/u.test(essai.raison) ? MESSAGE_PORTEE : essai.raison,
    operation: null,
  })
}

/**
 * Fait avancer la collecte d'un pas.
 *
 * `auto` : à l'ouverture de l'écran, seulement si l'index a plus de douze heures. `manuel` :
 * sur un clic, sauf si le dernier essai date de moins de deux minutes. `suivre` : ne lance
 * rien, relit seulement l'export en cours — c'est ce que l'écran demande en attendant.
 */
export async function synchroniserLina(userId: string, mode: 'auto' | 'manuel' | 'suivre', maintenant = new Date()): Promise<EtatLina> {
  const lu = await acces(userId)
  if ('etat' in lu) return lu.etat
  const ligne = await withUserScope(userId, (tx) => tx.linaSynchro.findUnique({ where: { userId } }))

  try {
    // Un export est en route : on ne fait que le suivre.
    if (ligne?.operation != null) {
      const frappe = await frapperJeton(lu.acces)
      if (!frappe.ok) {
        await markConnectionError(userId, lu.connectionId, frappe.raison)
        await noter(userId, { etat: 'erreur', message: frappe.raison, operation: null })
        return lireEtatLina(userId)
      }
      const [operation, variante] = [ligne.operation.slice(0, -2), ligne.operation.slice(-2)]
      const consentement = variante === AVEC_CONSENTEMENT
      const suivi = await suivreExport(lu.acces, frappe.jeton, operation)
      if (suivi.statut === 'en-cours') {
        if (ligne.lanceAt !== null && +maintenant - +ligne.lanceAt > EXPORT_PERIME_MS) {
          await noter(userId, { etat: 'erreur', message: 'L’export Shopify n’a pas abouti. Relancez l’analyse.', operation: null })
        }
        return lireEtatLina(userId)
      }
      if (suivi.statut === 'refuse') {
        if (consentement) {
          await lancer(userId, lu.acces, frappe.jeton, maintenant, false)
        } else {
          await noter(userId, { etat: 'protegees', message: MESSAGE_PROTEGEES, operation: null })
        }
        return lireEtatLina(userId)
      }
      if (suivi.statut === 'echec') {
        await noter(userId, { etat: 'erreur', message: suivi.raison, operation: null })
        return lireEtatLina(userId)
      }
      // Terminé : pas d'adresse veut dire aucun client.
      const { clients, tronque } = suivi.url === null ? { clients: [], tronque: false } : await telechargerExport(suivi.url, consentement)
      await ecrireClients(userId, clients)
      await noter(userId, {
        etat: 'ok',
        message: '',
        operation: null,
        synchroAt: maintenant,
        clients: clients.length,
        tronque,
        consentement,
      })
      logger.info('clients relus pour Lina', { clients: clients.length, tronque })
      return lireEtatLina(userId)
    }

    if (mode === 'suivre') return lireEtatLina(userId)
    const essai = ligne?.essaiAt ?? null
    const relire =
      mode === 'auto'
        ? aRelire(
            {
              etat: ligne === null ? 'jamais' : ligne.etat === 'ok' ? 'ok' : ligne.etat === 'jamais' ? 'jamais' : 'erreur',
              synchroAt: ligne?.synchroAt ?? null,
              essaiAt: essai,
            },
            maintenant,
          )
        : !(essai !== null && +maintenant - +essai < PAUSE_MANUELLE_MS)
    if (!relire) return lireEtatLina(userId)
    await noter(userId, { essaiAt: maintenant })

    const frappe = await frapperJeton(lu.acces)
    if (!frappe.ok) {
      await markConnectionError(userId, lu.connectionId, frappe.raison)
      await noter(userId, { etat: 'erreur', message: frappe.raison })
      return lireEtatLina(userId)
    }
    const portees = await lirePortees(lu.acces, frappe.jeton)
    if (portees !== null && !portees.includes('read_customers')) {
      await noter(userId, { etat: 'portee', message: MESSAGE_PORTEE })
      return lireEtatLina(userId)
    }

    // Les paniers d'abord : quelques pages, lues tout de suite, indépendantes de l'export.
    const depuis = jourIso(new Date(+maintenant - 2 * JOURS_PANIERS * JOUR_MS))
    const lecture = portees === null || portees.includes('read_orders') ? await lirePaniersAbandonnes(lu.acces, frappe.jeton, depuis) : null
    const paniers: PaniersLina | null =
      lecture === null
        ? null
        : lecture.ok
          ? agregerPaniers(lecture.paniers, maintenant, lecture.tronque)
          : { ...agregerPaniers([], maintenant, false), erreur: lecture.raison }
    if (paniers !== null) await noter(userId, { paniers: paniers as unknown as Prisma.InputJsonValue })

    await lancer(userId, lu.acces, frappe.jeton, maintenant, true)
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'Shopify n’a pas répondu.'
    await noter(userId, { etat: 'erreur', message: raison.slice(0, 300), operation: null }).catch(() => undefined)
    logger.warn('collecte de Lina en échec', { userId })
  }
  return lireEtatLina(userId)
}
