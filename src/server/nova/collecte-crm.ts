import type { Prisma } from '@prisma/client'
import { jourDansFuseau } from '@/server/ads/metriques'
import { withUserScope } from '@/server/db/scope'
import { lireAffaires, lireCompteHubspot, lireContacts } from '@/server/integrations/providers/hubspot'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'
import { agregerCrm, type InstantaneCrm } from './agregat-crm'
import { ABSENT, aRelire, ecrireJours, etatEnBase, JOUR_MS, JOURS_LUS, jourIso, noterSynchro, PAUSE_MANUELLE_MS, type EtatVentes } from './collecte-commerce'
import { FOURNISSEUR_SOURCE } from './sources'

/**
 * Le CRM pour Nova : HubSpot, lu comme les autres sources, aux mêmes rythmes.
 *
 * Chaque lecture relit toute la fenêtre de cent quatre-vingts jours : un prospect d'il y a
 * trois mois peut signer aujourd'hui, et c'est justement ce qu'on veut voir. Trois choses sont
 * écrites : les prospects et clients par jour (CrmJour), l'instantané des cohortes
 * (CrmSynchro), et les transactions gagnées rangées comme des ventes (CommerceJour, source
 * « hubspot ») — elles ne font le chiffre d'affaires que sans autre source de ventes.
 */

const SOURCE = 'hubspot' as const
const BOUTIQUE = 'hubspot'
const ABSENT_CRM: EtatVentes = { ...ABSENT, source: SOURCE, nom: 'HubSpot' }

export type EtatCrm = {
  etat: 'absent' | 'jamais' | 'ok' | 'erreur'
  message: string
  synchroAt: Date | null
  couvertureDepuis: string | null
  tronque: boolean
  instantane: InstantaneCrm | null
}

const SANS_CRM: EtatCrm = { etat: 'absent', message: '', synchroAt: null, couvertureDepuis: null, tronque: false, instantane: null }

function lireInstantaneCrm(brut: unknown): InstantaneCrm | null {
  if (brut === null || typeof brut !== 'object') return null
  const valeur = brut as Partial<InstantaneCrm>
  return typeof valeur.au === 'string' && Array.isArray(valeur.cohortes) ? (valeur as InstantaneCrm) : null
}

export async function lireEtatCrm(userId: string): Promise<EtatCrm> {
  // Un jeton refusé met la connexion en erreur : Nova le dit et garde les derniers chiffres,
  // plutôt que de faire comme si HubSpot n'avait jamais été relié.
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.hubspot, { includePending: true }).catch(() => null)
  if (connexion === null) return SANS_CRM
  const ligne = await withUserScope(userId, (tx) => tx.crmSynchro.findUnique({ where: { userId } }))
  if (ligne === null) return { ...SANS_CRM, etat: 'jamais' }
  return {
    etat: ligne.etat as EtatCrm['etat'],
    message: ligne.message,
    synchroAt: ligne.synchroAt,
    couvertureDepuis: ligne.couvertureDepuis === null ? null : jourIso(ligne.couvertureDepuis),
    tronque: ligne.tronque,
    instantane: lireInstantaneCrm(ligne.instantane),
  }
}

/** Les transactions gagnées comme source de ventes, quand aucune boutique ni Stripe n'est relié. */
export async function lireEtatVentesCrm(userId: string): Promise<EtatVentes> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.hubspot).catch(() => null)
  if (connexion === null) return ABSENT_CRM
  return etatEnBase(userId, SOURCE, BOUTIQUE)
}

async function noter(userId: string, data: Omit<Prisma.CrmSynchroUncheckedCreateInput, 'userId'>): Promise<void> {
  await withUserScope(userId, (tx) => tx.crmSynchro.upsert({ where: { userId }, create: { userId, ...data }, update: data }))
}

export async function synchroniserCrm(userId: string, mode: 'auto' | 'manuel', maintenant = new Date()): Promise<EtatCrm> {
  const connexion = await useCredential(userId, FOURNISSEUR_SOURCE.hubspot).catch(() => null)
  if (connexion === null) return SANS_CRM
  const precedente = await withUserScope(userId, (tx) => tx.crmSynchro.findUnique({ where: { userId } }))
  const essai = precedente?.essaiAt ?? null
  const relire =
    mode === 'auto'
      ? aRelire({ etat: (precedente?.etat ?? 'jamais') as EtatVentes['etat'], synchroAt: precedente?.synchroAt ?? null, essaiAt: essai }, maintenant)
      : !(essai !== null && +maintenant - +essai < PAUSE_MANUELLE_MS)
  if (!relire) return lireEtatCrm(userId)
  await noter(userId, { essaiAt: maintenant })

  try {
    const compte = await lireCompteHubspot(connexion.secret)
    const fuseau = compte.fuseau || precedente?.fuseau || 'Europe/Zurich'
    const aujourdhui = jourDansFuseau(maintenant, fuseau)
    const depuis = jourIso(new Date(Date.parse(aujourdhui) - JOURS_LUS * JOUR_MS))
    const [contacts, affaires] = await Promise.all([lireContacts(connexion.secret, depuis), lireAffaires(connexion.secret, depuis)])
    const echec = [contacts, affaires].find((un) => !un.ok)
    if (echec !== undefined && !echec.ok) {
      await markConnectionError(userId, connexion.connectionId, echec.raison)
      await noter(userId, { etat: 'erreur', message: echec.raison.slice(0, 300) })
      await noterSynchro(userId, SOURCE, BOUTIQUE, { etat: 'erreur', message: echec.raison.slice(0, 300), essaiAt: maintenant })
      return lireEtatCrm(userId)
    }
    const lus = { contacts: contacts.ok ? contacts.contacts : [], affaires: affaires.ok ? affaires.affaires : [] }
    const tronque = (contacts.ok && contacts.tronque) || (affaires.ok && affaires.tronque)
    const { jours, ventes, instantane } = agregerCrm(lus.contacts, lus.affaires, fuseau, depuis, aujourdhui)

    await withUserScope(userId, async (tx) => {
      await tx.crmJour.deleteMany({ where: { userId, jour: { gte: new Date(depuis) } } })
      if (jours.length > 0) {
        await tx.crmJour.createMany({
          data: jours.map((jour) => ({
            userId,
            jour: new Date(jour.jour),
            prospects: jour.prospects,
            clients: jour.clients,
            canaux: jour.canaux as Prisma.InputJsonValue,
          })),
        })
      }
      await tx.crmJour.deleteMany({ where: { userId, jour: { lt: new Date(+maintenant - 400 * JOUR_MS) } } })
    })
    await ecrireJours(userId, SOURCE, BOUTIQUE, depuis, null, ventes, maintenant)
    const devise = compte.devise || ventes[0]?.devise || precedente?.devise || ''
    await noterSynchro(userId, SOURCE, BOUTIQUE, {
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      essaiAt: maintenant,
      couvertureDepuis: new Date(depuis),
      tronque,
      devise,
      fuseau,
    })
    await noter(userId, {
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      couvertureDepuis: new Date(depuis),
      fuseau,
      devise,
      tronque,
      instantane: instantane as unknown as Prisma.InputJsonValue,
    })
    logger.info('CRM synchronisé', { prospects: lus.contacts.length, affaires: lus.affaires.length })
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'HubSpot n’a pas répondu.'
    await noter(userId, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('synchronisation du CRM en échec', { userId })
  }
  return lireEtatCrm(userId)
}

/** Pour la source de ventes : la même lecture, rendue sous la forme d'un état de ventes. */
export async function synchroniserVentesCrm(userId: string, mode: 'auto' | 'manuel', maintenant = new Date()): Promise<EtatVentes> {
  await synchroniserCrm(userId, mode, maintenant)
  return lireEtatVentesCrm(userId)
}
