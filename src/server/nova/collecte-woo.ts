import { jourDansFuseau } from '@/server/ads/metriques'
import { lireAccesWoo, lireCommandesWoo, lireFuseauWoo } from '@/server/integrations/providers/woocommerce'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'
import { agregerCommandes } from './agregat'
import {
  ABSENT,
  aLireMaintenant,
  ecrireJours,
  etatEnBase,
  JOUR_MS,
  JOURS_LUS,
  JOURS_RATTRAPES,
  jourIso,
  noterSynchro,
  type EtatVentes,
} from './collecte-commerce'
import { FOURNISSEUR_SOURCE } from './sources'

/**
 * Les ventes WooCommerce, lues comme celles de Shopify et rangées de la même façon.
 *
 * Deux différences, dites plutôt que comblées. WooCommerce ne dit pas si une commande est la
 * première d'un client : nouveaux clients et CAC restent absents. Il ne connaît pas le coût
 * des produits : la marge se fait sur le pourcentage saisi. L'origine d'une commande vient de
 * son « Order Attribution » (WooCommerce 8.5 et suivants) ; avant, elle est inconnue.
 */

const SOURCE = 'woocommerce' as const
const ABSENT_WOO: EtatVentes = { ...ABSENT, source: SOURCE, nom: 'WooCommerce' }

export async function lireEtatWoo(userId: string): Promise<EtatVentes> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.woocommerce).catch(() => null)
  if (connexion === null) return ABSENT_WOO
  const acces = lireAccesWoo(connexion.secret)
  if (acces === null) return { ...ABSENT_WOO, etat: 'erreur', message: 'Votre connexion WooCommerce est abîmée. Reconnectez-la.' }
  return etatEnBase(userId, SOURCE, acces.boutique)
}

export async function synchroniserWoo(userId: string, mode: 'auto' | 'manuel', maintenant = new Date()): Promise<EtatVentes> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.woocommerce).catch(() => null)
  if (connexion === null) return ABSENT_WOO
  const acces = lireAccesWoo(connexion.secret)
  if (acces === null) return { ...ABSENT_WOO, etat: 'erreur', message: 'Votre connexion WooCommerce est abîmée. Reconnectez-la.' }

  const { lire, precedente } = await aLireMaintenant(userId, SOURCE, acces.boutique, mode, maintenant)
  if (!lire) return lireEtatWoo(userId)
  await noterSynchro(userId, SOURCE, acces.boutique, { essaiAt: maintenant })

  try {
    const fuseau = (await lireFuseauWoo(acces).catch(() => '')) || precedente?.fuseau || 'Europe/Zurich'
    const aujourdhui = jourDansFuseau(maintenant, fuseau)
    const debutFenetre = jourIso(new Date(Date.parse(aujourdhui) - JOURS_LUS * JOUR_MS))
    const derniere = precedente?.synchroAt ?? null
    const complete = mode === 'manuel' || derniere === null
    const depuis = complete
      ? debutFenetre
      : [debutFenetre, jourIso(new Date(+derniere - JOURS_RATTRAPES * JOUR_MS))].sort().at(-1)!

    const lecture = await lireCommandesWoo(acces, depuis)
    if (!lecture.ok) {
      await markConnectionError(userId, connexion.connectionId, lecture.raison)
      await noterSynchro(userId, SOURCE, acces.boutique, { etat: 'erreur', message: lecture.raison.slice(0, 300) })
      return lireEtatWoo(userId)
    }
    const jours = agregerCommandes(lecture.commandes, fuseau)
    const dernierLu = lecture.tronque ? (jours.at(-1)?.jour ?? depuis) : null
    await ecrireJours(userId, SOURCE, acces.boutique, depuis, dernierLu, jours, maintenant)
    const devise = jours[0]?.devise ?? precedente?.devise ?? ''
    await noterSynchro(userId, SOURCE, acces.boutique, {
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      // WooCommerce rend tout l'historique : la couverture est la fenêtre lue.
      couvertureDepuis: new Date(complete || precedente?.couvertureDepuis == null ? depuis : jourIso(precedente.couvertureDepuis)),
      tronque: lecture.tronque,
      devise,
      fuseau,
    })
    logger.info('ventes WooCommerce synchronisées', { jours: jours.length, commandes: lecture.commandes.length, complete })
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'La boutique n’a pas répondu.'
    await noterSynchro(userId, SOURCE, acces.boutique, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('synchronisation WooCommerce en échec', { userId })
  }
  return lireEtatWoo(userId)
}
