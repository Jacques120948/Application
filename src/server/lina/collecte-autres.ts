import { createHmac } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { env } from '@/lib/env'
import { withUserScope } from '@/server/db/scope'
import { lireAccesWoo, lireCommandesClientsWoo, lireFuseauWoo, type CommandeExportWoo } from '@/server/integrations/providers/woocommerce'
import { lireEncaissementsClients } from '@/server/integrations/providers/stripe-lecture'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { aRelire, JOUR_MS, jourIso, PAUSE_MANUELLE_MS } from '@/server/nova/collecte-commerce'
import { FOURNISSEUR_SOURCE } from '@/server/nova/sources'
import { logger } from '@/server/observability/logger'
import { analyserCommandes, type AnalyseCommandes } from './commandes'
import { criteresLina } from './criteres'
import type { SourceLina } from './sources'

/**
 * Lina sans Shopify : la base clients d'une boutique WooCommerce, ou les clients Stripe.
 *
 * Ni l'un ni l'autre ne fournit un export des clients avec leurs totaux : l'index se
 * reconstruit donc à partir des commandes (WooCommerce) ou des paiements (Stripe) des trois
 * dernières années, lus d'un seul passage, dans le temps d'une fonction. Les commandes ne
 * sont pas gardées — comme avec Shopify, il en reste une ligne par client et des totaux.
 *
 * Ce que ces sources ne donnent pas est dit, pas deviné : ni consentement marketing (à
 * vérifier dans l'outil d'envoi), ni paniers abandonnés ; Stripe ne dit pas quels produits.
 */

export type EtatAutre = {
  source: Exclude<SourceLina, 'shopify'>
  boutique: string
  connectionId: string
  lire: () => Promise<LectureAutre>
}

export type CommandeLina = CommandeExportWoo
type LectureAutre = { ok: true; commandes: CommandeLina[]; tronque: boolean; sansClient: number; fuseau: string } | { ok: false; raison: string }

/** Trois ans, comme avec Shopify quand read_all_orders est accordé. */
const JOURS_HISTOIRE = 1_095
/** Le temps de lecture laissé à un passage : la fonction en a soixante. */
const LECTURE_MS = 40_000
const COMMANDES_MAX = 50_000
const LIGNES_PAR_LOT = 2_000

/**
 * L'empreinte d'un courriel : de quoi reconnaître deux achats de la même personne sans
 * garder son adresse. Une clé propre à Evoliia : l'empreinte ne se recalcule pas ailleurs.
 */
export function pseudonyme(courriel: string): string {
  return createHmac('sha256', env.sessionSecret).update(`lina-client:${courriel}`).digest('base64url').slice(0, 22)
}

/**
 * WooCommerce d'abord, Stripe ensuite : une boutique vend rarement par les deux.
 * `enErreur` : une clé refusée reste une source reliée pour l'écran, qui doit dire pourquoi.
 */
export async function sourceAutre(userId: string, enErreur = false): Promise<EtatAutre | null> {
  const woo = await useCredential(userId, FOURNISSEUR_SOURCE.woocommerce, { includePending: enErreur }).catch(() => null)
  if (woo !== null) {
    const acces = lireAccesWoo(woo.secret)
    if (acces !== null) {
      return {
        source: 'woocommerce',
        boutique: acces.boutique,
        connectionId: woo.connectionId,
        lire: async () => {
          const depuis = jourIso(new Date(Date.now() - JOURS_HISTOIRE * JOUR_MS))
          const [lecture, fuseau] = await Promise.all([
            lireCommandesClientsWoo(acces, depuis, { max: COMMANDES_MAX, echeance: Date.now() + LECTURE_MS, pseudonyme }),
            lireFuseauWoo(acces).catch(() => ''),
          ])
          return lecture.ok ? { ...lecture, fuseau: fuseau || 'Europe/Zurich' } : lecture
        },
      }
    }
  }
  const stripe = await useCredential(userId, FOURNISSEUR_SOURCE.stripe, { includePending: enErreur }).catch(() => null)
  if (stripe !== null) {
    return {
      source: 'stripe',
      boutique: '',
      connectionId: stripe.connectionId,
      lire: async () => {
        const depuis = jourIso(new Date(Date.now() - JOURS_HISTOIRE * JOUR_MS))
        const lecture = await lireEncaissementsClients(stripe.secret, depuis, { max: COMMANDES_MAX, echeance: Date.now() + LECTURE_MS })
        return lecture.ok ? { ...lecture, fuseau: 'Europe/Zurich' } : lecture
      },
    }
  }
  return null
}

export type ClientReconstruit = {
  ref: string
  creeLe: string
  derniereCommande: string
  commandes: number
  caCents: number
  devise: string
}

/** Une ligne par client, tirée de ses commandes. Pur. */
export function indexDepuisCommandes(commandes: readonly CommandeLina[]): ClientReconstruit[] {
  const parClient = new Map<string, ClientReconstruit>()
  for (const commande of commandes) {
    if (commande.clientRef === null) continue
    const connu = parClient.get(commande.clientRef)
    if (connu === undefined) {
      parClient.set(commande.clientRef, {
        ref: commande.clientRef,
        creeLe: commande.creeLe,
        derniereCommande: commande.creeLe,
        commandes: 1,
        caCents: commande.totalCents,
        devise: commande.devise,
      })
      continue
    }
    connu.commandes += 1
    connu.caCents += commande.totalCents
    if (commande.creeLe < connu.creeLe) connu.creeLe = commande.creeLe
    if (commande.creeLe > connu.derniereCommande) connu.derniereCommande = commande.creeLe
  }
  return [...parClient.values()]
}

async function noter(userId: string, data: Omit<Prisma.LinaSynchroUncheckedCreateInput, 'userId'>): Promise<void> {
  await withUserScope(userId, (tx) => tx.linaSynchro.upsert({ where: { userId }, create: { userId, ...data }, update: data }))
}

async function ecrire(userId: string, source: SourceLina, clients: readonly ClientReconstruit[], resultat: ReturnType<typeof analyserCommandes>): Promise<void> {
  const parClient = new Map(resultat.parClient.map((un) => [un.ref, un]))
  // Tout l'index de la personne est remplacé : une autre source ne doit pas s'y mêler.
  await withUserScope(userId, (tx) => tx.linaClient.deleteMany({ where: { userId } }))
  for (let debut = 0; debut < clients.length; debut += LIGNES_PAR_LOT) {
    const lot = clients.slice(debut, debut + LIGNES_PAR_LOT)
    await withUserScope(userId, (tx) =>
      tx.linaClient.createMany({
        data: lot.map((client) => {
          const appris = parClient.get(client.ref)
          return {
            userId,
            source,
            ref: client.ref,
            creeLe: new Date(client.creeLe),
            derniereCommande: new Date(client.derniereCommande),
            commandes: client.commandes,
            caCents: Math.min(client.caCents, 2_000_000_000),
            devise: client.devise,
            consentement: 'inconnu',
            premiereCommande: appris?.premiereCommande == null ? null : new Date(appris.premiereCommande),
            intervalleJours: appris?.intervalleJours ?? null,
            produitPrincipal: appris?.produitPrincipal ?? null,
          }
        }),
        skipDuplicates: true,
      }),
    )
  }
  await withUserScope(userId, (tx) => tx.linaProduit.deleteMany({ where: { userId } }))
  for (let debut = 0; debut < resultat.produits.length; debut += LIGNES_PAR_LOT) {
    const lot = resultat.produits.slice(debut, debut + LIGNES_PAR_LOT)
    await withUserScope(userId, (tx) => tx.linaProduit.createMany({ data: lot.map((produit) => ({ userId, ...produit })), skipDuplicates: true }))
  }
}

/**
 * Un passage de collecte : au rythme de Shopify (douze heures à l'ouverture, deux minutes
 * entre deux clics), mais d'un seul tenant — pas d'export à suivre.
 */
export async function synchroniserAutre(
  userId: string,
  autre: EtatAutre,
  mode: 'auto' | 'manuel' | 'suivre',
  maintenant = new Date(),
): Promise<void> {
  if (mode === 'suivre') return
  const ligne = await withUserScope(userId, (tx) => tx.linaSynchro.findUnique({ where: { userId } }))
  const memeSource = ligne?.source === autre.source
  const essai = memeSource ? (ligne?.essaiAt ?? null) : null
  const relire =
    mode === 'auto'
      ? !memeSource ||
        aRelire(
          { etat: ligne?.etat === 'ok' ? 'ok' : ligne?.etat === 'jamais' || ligne === null ? 'jamais' : 'erreur', synchroAt: ligne?.synchroAt ?? null, essaiAt: essai },
          maintenant,
        )
      : !(essai !== null && +maintenant - +essai < PAUSE_MANUELLE_MS)
  if (!relire) return
  // Une autre source que la précédente : on repart de zéro, sans rien reprendre de l'ancienne.
  const remise = memeSource
    ? {}
    : { source: autre.source, synchroAt: null, clients: 0, analyse: {} as Prisma.InputJsonValue, commandesAt: null, commandesMessage: '', emailingAt: ligne?.emailingAt ?? null }
  await noter(userId, { ...remise, source: autre.source, essaiAt: maintenant, etat: 'en-cours', message: '', operation: null, paniers: {} })

  try {
    const lecture = await autre.lire()
    if (!lecture.ok) {
      await markConnectionError(userId, autre.connectionId, lecture.raison)
      await noter(userId, { etat: 'erreur', message: lecture.raison.slice(0, 300) })
      return
    }
    const clients = indexDepuisCommandes(lecture.commandes)
    const depuis = lecture.commandes.reduce((min, commande) => (commande.creeLe < min ? commande.creeLe : min), maintenant.toISOString()).slice(0, 10)
    const resultat = analyserCommandes(lecture.commandes, new Map(clients.map((client) => [client.ref, client.commandes])), {
      depuis,
      tronque: lecture.tronque,
      historiqueComplet: false,
      fuseau: lecture.fuseau,
      maintenant,
      seuilReactivation: (await criteresLina(userId)).actifJours,
    })
    await ecrire(userId, autre.source, clients, resultat)
    const analyse: AnalyseCommandes & { sansClient: number } = { ...resultat.analyse, sansClient: lecture.sansClient }
    await noter(userId, {
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      clients: clients.length,
      tronque: lecture.tronque,
      consentement: false,
      analyse: analyse as unknown as Prisma.InputJsonValue,
      commandesAt: maintenant,
      commandesMessage: '',
    })
    logger.info('clients relus pour Lina', { source: autre.source, clients: clients.length, commandes: lecture.commandes.length, tronque: lecture.tronque })
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'La source n’a pas répondu.'
    await noter(userId, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('collecte de Lina en échec', { userId, source: autre.source })
  }
}
