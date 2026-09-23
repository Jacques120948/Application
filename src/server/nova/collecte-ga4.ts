import type { Prisma } from '@prisma/client'
import { jourDansFuseau } from '@/server/ads/metriques'
import { listSites } from '@/server/audit/service'
import { withUserScope } from '@/server/db/scope'
import {
  listerProprietes,
  lireReglagesPropriete,
  rafraichir,
  rapport,
  type ProprieteGa4,
} from '@/server/integrations/providers/google-analytics'
import { useCredential, useOAuthAccess } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'
import { AppError } from '@/lib/errors'
import { FRAICHEUR_MS, JOURS_LUS } from './collecte'
import { agregerVisites, DIMENSIONS_CANAUX, DIMENSIONS_PAGES, METRIQUES, METRIQUES_PAGES } from './agregat-ga4'

/**
 * La collecte des visites : Google Analytics 4 vers Evoliia.
 *
 * Mêmes règles que les ventes, pour les mêmes raisons : relue au plus toutes les douze
 * heures à l'ouverture de Nova, relue en entier sur « Actualiser », et une panne laisse les
 * jours déjà lus à l'écran. Trois rapports par lecture — canaux, pages d'entrée, pages
 * d'entrée de la recherche naturelle — et rien d'autre.
 */

const JOUR_MS = 24 * 60 * 60 * 1000
const PAUSE_APRES_ECHEC_MS = 30 * 60 * 1000
const PAUSE_MANUELLE_MS = 2 * 60 * 1000
const JOURS_RATTRAPES = 3
const JOURS_GARDES = 400
const FOURNISSEUR = 'google-analytics'

export type EtatVisites = {
  etat: 'absent' | 'jamais' | 'ok' | 'erreur'
  message: string
  propriete: string
  nom: string
  synchroAt: Date | null
  couvertureDepuis: string | null
  devise: string
  fuseau: string
}

const ABSENT: EtatVisites = { etat: 'absent', message: '', propriete: '', nom: '', synchroAt: null, couvertureDepuis: null, devise: '', fuseau: '' }

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function ligneSynchro(userId: string) {
  return withUserScope(userId, (tx) => tx.analyticsSynchro.findUnique({ where: { userId } }))
}

export async function lireEtatVisites(userId: string): Promise<EtatVisites> {
  const connexion = await useCredential(userId, FOURNISSEUR).catch(() => null)
  if (connexion === null) return ABSENT
  const ligne = await ligneSynchro(userId)
  if (ligne === null) return { ...ABSENT, etat: 'jamais' }
  return {
    etat: ligne.etat as EtatVisites['etat'],
    message: ligne.message,
    propriete: ligne.propriete,
    nom: ligne.nom,
    synchroAt: ligne.synchroAt,
    couvertureDepuis: ligne.couvertureDepuis === null ? null : jourIso(ligne.couvertureDepuis),
    devise: ligne.devise,
    fuseau: ligne.fuseau,
  }
}

async function noter(userId: string, data: Omit<Prisma.AnalyticsSynchroUncheckedCreateInput, 'userId'>): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.analyticsSynchro.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
  )
}

/**
 * La propriété qui correspond au site : celle dont le nom contient son adresse, sinon la
 * première. La personne peut en choisir une autre depuis l'écran de Nova.
 */
export function proprieteDuSite(proprietes: readonly ProprieteGa4[], hote: string | null): ProprieteGa4 | null {
  if (proprietes.length === 0) return null
  const cle = (hote ?? '').toLowerCase().replace(/^www\./u, '').split('.')[0] ?? ''
  return (cle === '' ? undefined : proprietes.find((propriete) => propriete.nom.toLowerCase().includes(cle))) ?? proprietes[0]!
}

export async function proprietesDisponibles(userId: string): Promise<ProprieteGa4[]> {
  const acces = await useOAuthAccess(userId, FOURNISSEUR, rafraichir)
  if (!acces.ok) return []
  const liste = await listerProprietes(acces.accessToken)
  return liste.ok ? liste.proprietes : []
}

/** Change de propriété suivie. Les jours de l'ancienne sont effacés : on ne mélange pas deux sites. */
export async function choisirPropriete(userId: string, propriete: string): Promise<void> {
  const proprietes = await proprietesDisponibles(userId)
  const choisie = proprietes.find((un) => un.id === propriete)
  if (choisie === undefined) throw new AppError('VALIDATION', 'Cette propriété n’est pas accessible avec votre compte Google.')
  await withUserScope(userId, (tx) => tx.analyticsJour.deleteMany({ where: { userId, propriete: { not: choisie.id } } }))
  await noter(userId, { propriete: choisie.id, nom: choisie.nom, etat: 'jamais', message: '', synchroAt: null, essaiAt: null, couvertureDepuis: null })
}

export async function synchroniserVisites(
  userId: string,
  mode: 'auto' | 'manuel',
  maintenant = new Date(),
): Promise<EtatVisites> {
  const connexion = await useCredential(userId, FOURNISSEUR).catch(() => null)
  if (connexion === null) return ABSENT
  const precedente = await ligneSynchro(userId)
  const essai = precedente?.essaiAt ?? null
  if (mode === 'auto') {
    const echecRecent = precedente?.etat !== 'ok' && essai !== null && +maintenant - +essai < PAUSE_APRES_ECHEC_MS
    const frais = precedente?.synchroAt != null && +maintenant - +precedente.synchroAt < FRAICHEUR_MS
    if (echecRecent || frais) return lireEtatVisites(userId)
  } else if (essai !== null && +maintenant - +essai < PAUSE_MANUELLE_MS) {
    return lireEtatVisites(userId)
  }

  await noter(userId, { essaiAt: maintenant })
  try {
    const acces = await useOAuthAccess(userId, FOURNISSEUR, rafraichir)
    if (!acces.ok) {
      await noter(userId, { etat: 'erreur', message: acces.raison })
      return lireEtatVisites(userId)
    }

    let propriete = precedente?.propriete ?? ''
    let nom = precedente?.nom ?? ''
    if (propriete === '') {
      const liste = await listerProprietes(acces.accessToken)
      const sites = await listSites(userId).catch(() => [])
      const choisie = liste.ok ? proprieteDuSite(liste.proprietes, sites[0]?.host ?? null) : null
      if (choisie === null) {
        await noter(userId, { etat: 'erreur', message: liste.ok ? 'Aucune propriété Google Analytics 4 accessible.' : liste.raison })
        return lireEtatVisites(userId)
      }
      propriete = choisie.id
      nom = choisie.nom
    }

    const reglages = await lireReglagesPropriete(acces.accessToken, propriete)
    const fuseau = reglages?.fuseau || precedente?.fuseau || 'Europe/Zurich'
    const aujourdhui = jourDansFuseau(maintenant, fuseau)
    const debut = jourIso(new Date(Date.parse(aujourdhui) - JOURS_LUS * JOUR_MS))
    const complete = mode === 'manuel' || precedente?.synchroAt == null || (precedente.propriete ?? '') !== propriete
    const depuis =
      complete || precedente?.synchroAt == null
        ? debut
        : [debut, jourIso(new Date(+precedente.synchroAt - JOURS_RATTRAPES * JOUR_MS))].sort().at(-1)!

    const bornes = { du: depuis, au: aujourdhui }
    const [canaux, pages, pagesSeo] = await Promise.all([
      rapport(acces.accessToken, propriete, { ...bornes, dimensions: DIMENSIONS_CANAUX, metriques: METRIQUES, limite: 100_000 }),
      rapport(acces.accessToken, propriete, { ...bornes, dimensions: DIMENSIONS_PAGES, metriques: METRIQUES_PAGES, limite: 100_000 }),
      rapport(acces.accessToken, propriete, {
        ...bornes,
        dimensions: DIMENSIONS_PAGES,
        metriques: METRIQUES_PAGES,
        filtreCanal: 'Organic Search',
        limite: 100_000,
      }),
    ])
    const echec = [canaux, pages, pagesSeo].find((un) => !un.ok)
    if (echec !== undefined && !echec.ok) {
      await noter(userId, { etat: 'erreur', message: echec.raison })
      return lireEtatVisites(userId)
    }
    const jours = agregerVisites(canaux.ok ? canaux.lignes : [], pages.ok ? pages.lignes : [], pagesSeo.ok ? pagesSeo.lignes : [])

    await withUserScope(userId, async (tx) => {
      await tx.analyticsJour.deleteMany({ where: { userId, propriete, jour: { gte: new Date(depuis) } } })
      if (jours.length > 0) {
        await tx.analyticsJour.createMany({
          data: jours.map((jour) => ({
            userId,
            propriete,
            jour: new Date(jour.jour),
            sessions: jour.sessions,
            sessionsEngagees: jour.sessionsEngagees,
            achats: jour.achats,
            revenuCents: BigInt(jour.revenuCents),
            canaux: jour.canaux as Prisma.InputJsonValue,
            appareils: jour.appareils as Prisma.InputJsonValue,
            pages: jour.pages as unknown as Prisma.InputJsonValue,
            pagesSeo: jour.pagesSeo as unknown as Prisma.InputJsonValue,
          })),
        })
      }
      await tx.analyticsJour.deleteMany({ where: { userId, jour: { lt: new Date(+maintenant - JOURS_GARDES * JOUR_MS) } } })
    })
    await noter(userId, {
      propriete,
      nom,
      etat: 'ok',
      message: '',
      synchroAt: maintenant,
      couvertureDepuis: complete ? new Date(debut) : (precedente?.couvertureDepuis ?? new Date(debut)),
      devise: reglages?.devise ?? precedente?.devise ?? '',
      fuseau,
    })
    logger.info('visites synchronisées', { jours: jours.length, complete })
  } catch (error) {
    const raison = error instanceof Error ? error.message : 'Google Analytics n’a pas répondu.'
    await noter(userId, { etat: 'erreur', message: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('synchronisation des visites en échec', { userId })
  }
  return lireEtatVisites(userId)
}
