import { getEntitlements } from '@/server/billing/entitlements'
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
import { hasConnection, markConnectionError, useCredential } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'
import type { Prisma } from '@prisma/client'
import { agregerCommandes, cohortesClients, instantaneClients } from './agregat'
import {
  ABSENT,
  aLireMaintenant,
  CLIENTS_VALABLES_MS,
  ecrireJours,
  etatEnBase,
  JOUR_MS,
  JOURS_CLIENTS,
  JOURS_LUS,
  JOURS_RATTRAPES,
  JOURS_SANS_HISTORIQUE,
  jourIso,
  lireInstantane,
  noterSynchro,
  SOURCE_SHOPIFY,
  type EtatVentes,
} from './collecte-commerce'
import { lireEtatWoo, synchroniserWoo } from './collecte-woo'
import { lireEtatEncaissements, synchroniserEncaissements } from './collecte-stripe'
import { FOURNISSEUR_SOURCE, type SourceVentes } from './sources'

export {
  ABSENT,
  aRelire,
  FRAICHEUR_MS,
  JOURS_LUS,
  lireInstantane,
  SOURCE_SHOPIFY,
  type EtatCouts,
  type EtatVentes,
} from './collecte-commerce'

/**
 * La collecte des ventes : la source qui fait référence vers Evoliia, une fois, puis relue
 * gratuitement. Les règles de rythme sont dans collecte-commerce.ts ; ce fichier lit Shopify
 * et choisit la source.
 */

/**
 * La source de ventes qui fait référence : la première reliée, dans l'ordre de sources.ts.
 * Une boutique Shopify que l'offre n'ouvre pas laisse la place à la suivante — sinon une
 * boutique WooCommerce reliée ne se verrait jamais.
 */
async function sourceReliee(userId: string): Promise<SourceVentes | null> {
  if (await hasConnection(userId, FOURNISSEUR_SOURCE.shopify).catch(() => false)) {
    const droits = await getEntitlements(userId)
    if (droits.granted.includes(SHOPIFY_FEATURE)) return 'shopify'
  }
  if (await hasConnection(userId, FOURNISSEUR_SOURCE.woocommerce).catch(() => false)) return 'woocommerce'
  if (await hasConnection(userId, FOURNISSEUR_SOURCE.stripe).catch(() => false)) return 'stripe'
  return null
}

/** L'état des ventes tel qu'il est en base, sans rien demander à aucune source. */
export async function lireEtatVentes(userId: string): Promise<EtatVentes> {
  const source = await sourceReliee(userId)
  if (source === 'woocommerce') return lireEtatWoo(userId)
  if (source === 'stripe') return lireEtatEncaissements(userId)
  return lireEtatShopify(userId)
}

/**
 * Synchronise les ventes de la source qui fait référence, si c'est utile.
 *
 * `auto` : à l'ouverture de l'écran, seulement si les données ont vieilli. `manuel` : le
 * bouton « Actualiser », qui relit toute la fenêtre. Ne lève jamais : une panne se note et se
 * dit, elle ne fait pas tomber Nova.
 */
export async function synchroniserVentes(userId: string, mode: 'auto' | 'manuel', maintenant = new Date()): Promise<EtatVentes> {
  const source = await sourceReliee(userId)
  if (source === 'woocommerce') return synchroniserWoo(userId, mode, maintenant)
  if (source === 'stripe') return synchroniserEncaissements(userId, mode, maintenant)
  return synchroniserShopify(userId, mode, maintenant)
}

export async function lireEtatShopify(userId: string): Promise<EtatVentes> {
  const connexion = await useCredential(userId, 'shopify').catch(() => null)
  if (connexion === null) return ABSENT
  const droits = await getEntitlements(userId)
  if (!droits.granted.includes(SHOPIFY_FEATURE)) return { ...ABSENT, etat: 'offre' }
  const acces = lireAcces(connexion.secret)
  if (acces === null) return { ...ABSENT, etat: 'erreur', message: 'Votre connexion Shopify est abîmée. Reconnectez-la.' }
  return etatEnBase(userId, 'shopify', acces.boutique)
}

async function synchroniserShopify(userId: string, mode: 'auto' | 'manuel', maintenant: Date): Promise<EtatVentes> {
  const connexion = await useCredential(userId, 'shopify').catch(() => null)
  if (connexion === null) return ABSENT
  const droits = await getEntitlements(userId)
  if (!droits.granted.includes(SHOPIFY_FEATURE)) return { ...ABSENT, etat: 'offre' }
  const acces = lireAcces(connexion.secret)
  if (acces === null) return { ...ABSENT, etat: 'erreur', message: 'Votre connexion Shopify est abîmée. Reconnectez-la.' }

  const { lire, precedente } = await aLireMaintenant(userId, 'shopify', acces.boutique, mode, maintenant)
  if (!lire) return lireEtatShopify(userId)
  const noter = (boutique: string, data: Omit<Prisma.CommerceSynchroUncheckedCreateInput, 'userId' | 'source' | 'boutique'>) =>
    noterSynchro(userId, SOURCE_SHOPIFY, boutique, data)

  await noter(acces.boutique, { essaiAt: maintenant })

  try {
    const frappe = await frapperJeton(acces)
    if (!frappe.ok) {
      await markConnectionError(userId, connexion.connectionId, frappe.raison)
      await noter(acces.boutique, { etat: 'erreur', message: frappe.raison })
      return lireEtatShopify(userId)
    }

    const portees = await lirePortees(acces, frappe.jeton)
    if (portees !== null && !portees.includes('read_orders')) {
      await noter(acces.boutique, {
        etat: 'portee',
        message:
          'L’autorisation « read_orders » manque à votre application Shopify. Ajoutez-la dans le Dev Dashboard (onglet « Versions »), publiez la version, puis actualisez.',
      })
      return lireEtatShopify(userId)
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

    const dernierLu = lecture.tronque ? (jours.at(-1)?.jour ?? depuis) : null
    await ecrireJours(userId, SOURCE_SHOPIFY, acces.boutique, depuis, dernierLu, jours, maintenant)

    // Le compte des clients : seulement sur une lecture complète, et seulement si Shopify a rendu les clients.
    const clients =
      complete && lecture.client && !lecture.tronque
        ? (() => {
            const debutClients = jourIso(new Date(Date.parse(aujourdhui) - JOURS_CLIENTS * JOUR_MS))
            const recentes = lecture.commandes.filter((commande) => commande.creeLe.slice(0, 10) >= debutClients)
            return instantaneClients(recentes, [debutClients, depuis].sort().at(-1)!, aujourdhui)
          })()
        : null
    // Les cohortes, sur toute la fenêtre lue : même condition que le compte des clients.
    const cohortes = complete && lecture.client && !lecture.tronque ? cohortesClients(lecture.commandes, fuseau, aujourdhui) : null
    await noter(acces.boutique, {
      ...(clients === null ? {} : { clients: clients as unknown as Prisma.InputJsonValue }),
      ...(cohortes === null ? {} : { cohortes: cohortes as unknown as Prisma.InputJsonValue }),
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
    await noter(acces.boutique, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('synchronisation des ventes en échec', { userId })
  }
  return lireEtatShopify(userId)
}
