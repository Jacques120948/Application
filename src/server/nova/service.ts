import type { IdMembre } from '@/lib/equipe'
import { NOM_CANAL } from '@/lib/nova'
import { compteActif, type CompteRelie } from '@/server/ads/comptes'
import { jourDansFuseau, enUnites, moisCourant } from '@/server/ads/metriques'
import { listSites } from '@/server/audit/service'
import { withUserScope } from '@/server/db/scope'
import {
  attribution,
  cumulVentes,
  ensemble,
  indicateursNova,
  performanceCampagnes,
  performanceCanaux,
  performanceProduits,
  periodeDe,
  periodePrecedente,
  type Attribution,
  type Donnees,
  type JourCampagne,
  type JourVentes,
  type Kpi,
  type LigneCampagne,
  type LigneCanal,
  type LigneProduit,
  type Periode,
  type PlateformePayante,
  MANQUE_VENTES,
  enPourcent,
  cumulVisites,
  type CumulVisites,
  type CumulVentes,
  type JourVisites,
  cumulPub,
  type JourCrmVue,
} from './metriques'
import {
  detecterAlertes,
  detecterInsights,
  detecterOpportunites,
  rapportPourOria,
  type Alerte,
  type Insight,
  type Opportunite,
  type RapportOria,
} from './analyse'
import { ABSENT, lireEtatVentes, type EtatVentes } from './collecte'
import type { SourceVentes } from './sources'
import { lireEtatAbonnements, type EtatAbonnements } from './collecte-stripe'
import { lireEtatCrm, type EtatCrm } from './collecte-crm'
import { lireCrm, type LectureCrm } from './crm'
import { indicateursAbonnements, type IndicateursAbonnements } from './abonnements'
import { lireAudiences, type Audiences } from './audiences'
import { prevoirVentes, type Prevision } from './previsions'
import { surveillance, type LigneSurveillance } from './surveillance'
import { lireEtatVisites, type EtatVisites } from './collecte-ga4'
import { prospectsNova, reglagesNova, REGLAGES_VIDES, type Reglages } from './reglages'
import type { Leads } from './leads'
import { controlesSuivi } from './suivi'
import { contenusQuiAttirent, type Contenus } from './contenus'
import {
  indicateursAVenir,
  margeEstimee,
  ordreIndicateurs,
  suivreObjectifs,
  type Marge,
  type SuiviObjectif,
} from './pilotage'
import {
  lectureParcours,
  modelesAttribution,
  repartitionClients,
  valeurClient,
  type LigneModele,
  type RepartitionClients,
  type ValeurClient,
} from './clients'

/**
 * Nova, assemblée : les sources, la collecte, les calculs et l'analyse, en une lecture.
 *
 * **Rien ici n'appelle une plateforme.** Google Ads et Meta sont relus dans ce que Naya et
 * MIRA ont déjà synchronisé ; Search Console dans les relevés de l'automatisation ; Shopify
 * dans ce que la collecte de Nova a écrit. L'écran peut s'ouvrir cent fois sans coûter un
 * appel à qui que ce soit, ni un crédit.
 *
 * **Une source qui manque n'emporte pas les autres.** Chaque lecture est isolée ; un compte
 * Meta délié ou une boutique en panne laisse le reste debout et se signale dans la santé
 * des données.
 */

const JOUR_MS = 24 * 60 * 60 * 1000
/** Au-delà, une source est dite ancienne : ses chiffres d'hier manquent sans doute. */
const VIEILLE_MS = 48 * 60 * 60 * 1000
const FUSEAU_DEFAUT = 'Europe/Zurich'
const CAMPAGNES_MAX = 20
const PRODUITS_MAX = 10

export type EtatSante = 'bon' | 'verifier' | 'probleme' | 'absent' | 'bientot'

export type LigneSante = {
  cle: string
  source: string
  etat: EtatSante
  texte: string
  action: { label: string; href: string } | null
  /**
   * À qui Nova peut transmettre ce point : Léa pour un suivi à auditer, la régie pour ses
   * propres liens. Absent : rien à transmettre (une source à relier, par exemple).
   */
  agent?: IdMembre
}

/**
 * Ce que coûte un nouvel abonné : la dépense publicitaire du mois précédent sur les abonnés
 * qui ont commencé à payer ce mois-là, et le nombre de mois de son abonnement qu'il faut
 * pour la rembourser. Toute la dépense est rapportée aux abonnés, y compris ce qui visait
 * autre chose : c'est un plafond, et c'est dit.
 */
export type AcquisitionAbonnes = { mois: string; depense: number; nouveaux: number; cac: number; rentabiliseEnMois: number | null }

export type VueNova = {
  periode: Periode
  precedente: { du: string; au: string }
  devise: string
  /** Rien de relié : Nova n'a rien à mesurer et le dit. */
  vierge: boolean
  /** Les sources dont les chiffres entrent dans cette vue. */
  sources: string[]
  kpis: Kpi[]
  canaux: LigneCanal[]
  attribution: Attribution
  campagnes: LigneCampagne[]
  produits: LigneProduit[]
  insights: Insight[]
  alertes: Alerte[]
  opportunites: Opportunite[]
  sante: { global: 'bon' | 'verifier' | 'probleme'; lignes: LigneSante[] }
  ventes: EtatVentes
  visites: EtatVisites
  /** Les visites de la période, pour les écrans qui détaillent appareils et pages. */
  visitesPeriode: CumulVisites | null
  /** Les articles de blog par lesquels on entre, et leur engagement. */
  contenus: Contenus
  /** Les prospects de la période (événements clés GA4), par canal ; `null` sans GA4 lu. */
  leads: Leads | null
  /** Le CRM : l'état de la lecture, et ce qu'on lit de ses cohortes de prospects. */
  crm: EtatCrm
  lectureCrm: LectureCrm | null
  /** Les abonnements Stripe : l'état de la lecture, et ce qu'on en tire quand elle a eu lieu. */
  abonnements: { etat: EtatAbonnements; indicateurs: IndicateursAbonnements | null; acquisition: AcquisitionAbonnes | null }
  /** Pays, nouveaux et connus, sur la période ; `null` sans GA4 ou avant la V6. */
  audiences: Audiences | null
  /** Les ventes des trente prochains jours et de la fin du mois ; `null` sans historique suffisant. */
  prevision: Prevision | null
  /** Chaque chiffre comparé à hier, 7, 30 et 90 jours, avec les écarts qui comptent. */
  surveillance: LigneSurveillance[]
  /** Pourquoi les ventes manquent, dit selon l'état réel de la boutique. Vide quand elles sont là. */
  manqueVentes: string
  /** Pourquoi les ventes ne se comparent pas à la période précédente, quand c'est le cas. */
  sansComparaison: string | null
  pourOria: RapportOria
  siteId: string
  reglages: Reglages
  /** L'ordre des cartes d'indicateurs, selon le type d'activité. */
  ordre: Kpi['cle'][]
  /** Ce que l'activité voudrait voir et qu'aucune source reliée ne donne encore. */
  aVenir: string | null
  marge: Marge
  objectifs: SuiviObjectif[]
  clients: RepartitionClients | null
  valeurClient: ValeurClient
  modeles: LigneModele[] | null
  parcours: string[]
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function decaler(jour: string, jours: number): string {
  return jourIso(new Date(Date.parse(jour) + jours * JOUR_MS))
}

/** « 22 septembre à 18:20 », dans le fuseau suisse. */
export function quandLisible(date: Date): string {
  const jour = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: FUSEAU_DEFAUT }).format(date)
  const heure = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU_DEFAUT }).format(date)
  return `${jour} à ${heure}`
}

async function sans<T>(promesse: Promise<T>, repli: T): Promise<T> {
  try {
    return await promesse
  } catch {
    return repli
  }
}

async function lireCampagnes(
  userId: string,
  comptes: readonly CompteRelie[],
  depuis: string,
  jusqua: string,
): Promise<JourCampagne[]> {
  if (comptes.length === 0) return []
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsReleve.findMany({
      where: {
        userId,
        accountId: { in: comptes.map((compte) => compte.id) },
        // Les lignes de campagne seulement : les niveaux en dessous compteraient la même dépense deux fois.
        groupeId: '',
        annonceId: '',
        jour: { gte: new Date(depuis), lte: new Date(jusqua) },
      },
      select: {
        accountId: true,
        jour: true,
        coutMicros: true,
        clics: true,
        impressions: true,
        conversions: true,
        valeurConversion: true,
        campagne: { select: { campagneId: true, nom: true } },
      },
    }),
  )
  const plateforme = new Map(comptes.map((compte) => [compte.id, compte.plateforme as PlateformePayante]))
  return lignes.map((ligne) => ({
    plateforme: plateforme.get(ligne.accountId)!,
    campagneId: ligne.campagne.campagneId,
    nom: ligne.campagne.nom === '' ? ligne.campagne.campagneId : ligne.campagne.nom,
    jour: jourIso(ligne.jour),
    depense: enUnites(Number(ligne.coutMicros)),
    clics: Number(ligne.clics),
    impressions: Number(ligne.impressions),
    conversions: ligne.conversions,
    valeur: ligne.valeurConversion,
  }))
}

async function lireVentes(userId: string, source: SourceVentes, boutique: string, depuis: string, jusqua: string): Promise<JourVentes[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.commerceJour.findMany({
      where: { userId, source, boutique, jour: { gte: new Date(depuis), lte: new Date(jusqua) } },
      orderBy: { jour: 'asc' },
    }),
  )
  type CanalBrut = Record<string, { commandes: number; chiffreCents: number; origines: Record<string, number> }>
  const enUnitesCanaux = (brut: CanalBrut) =>
    Object.fromEntries(
      Object.entries(brut).map(([canal, valeur]) => [
        canal,
        { commandes: valeur.commandes, chiffre: valeur.chiffreCents / 100, origines: valeur.origines ?? {} },
      ]),
    )
  return lignes.map((ligne) => {
    const canaux = (ligne.canaux ?? {}) as CanalBrut
    const produits = (ligne.produits ?? []) as {
      id: string
      titre: string
      commandes: number
      quantite: number
      chiffreCents: number
      coutCents?: number
      quantiteCoutee?: number
    }[]
    return {
      jour: jourIso(ligne.jour),
      commandes: ligne.commandes,
      chiffre: Number(ligne.chiffreCents) / 100,
      nouveauxClients: ligne.nouveauxClients,
      chiffreNouveaux: Number(ligne.chiffreNouveauxCents) / 100,
      clientsIdentifies: ligne.clientsIdentifies,
      canaux: enUnitesCanaux(canaux),
      canauxPremier: enUnitesCanaux((ligne.canauxPremier ?? {}) as CanalBrut),
      produits: produits.map(({ coutCents, chiffreCents, ...produit }) => ({
        ...produit,
        chiffre: chiffreCents / 100,
        cout: (coutCents ?? 0) / 100,
        quantiteCoutee: produit.quantiteCoutee ?? 0,
      })),
      coutsLus: ligne.coutsLus,
      lignes: Number(ligne.lignesCents) / 100,
      lignesCoutees: Number(ligne.lignesCouteesCents) / 100,
      coutProduits: Number(ligne.coutProduitsCents) / 100,
    }
  })
}

async function lireVisites(userId: string, propriete: string, depuis: string, jusqua: string): Promise<JourVisites[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.analyticsJour.findMany({
      where: { userId, propriete, jour: { gte: new Date(depuis), lte: new Date(jusqua) } },
      orderBy: { jour: 'asc' },
    }),
  )
  type Brut = { sessions: number; achats: number; revenuCents: number; origines: Record<string, number> }
  type PageBrute = { page: string; sessions: number; achats: number; revenuCents: number; engagees?: number }
  const pages = (brut: unknown) =>
    ((brut ?? []) as PageBrute[]).map((page) => ({
      page: page.page,
      sessions: page.sessions,
      achats: page.achats,
      revenu: page.revenuCents / 100,
      ...(typeof page.engagees === 'number' ? { engagees: page.engagees } : {}),
    }))
  return lignes.map((ligne) => ({
    jour: jourIso(ligne.jour),
    sessions: ligne.sessions,
    sessionsEngagees: ligne.sessionsEngagees,
    achats: ligne.achats,
    revenu: Number(ligne.revenuCents) / 100,
    canaux: Object.fromEntries(
      Object.entries((ligne.canaux ?? {}) as Record<string, Brut>).map(([canal, valeur]) => [
        canal,
        { sessions: valeur.sessions, achats: valeur.achats, revenu: valeur.revenuCents / 100, origines: valeur.origines ?? {} },
      ]),
    ),
    appareils: (ligne.appareils ?? {}) as Record<string, { sessions: number; achats: number }>,
    pages: pages(ligne.pages),
    pagesSeo: pages(ligne.pagesSeo),
    pays: (ligne.pays ?? {}) as Record<string, { sessions: number; achats: number }>,
    visiteurs: (ligne.visiteurs ?? {}) as JourVisites['visiteurs'],
    evenements: (ligne.evenements ?? {}) as JourVisites['evenements'],
    demographie: (ligne.demographie ?? {}) as JourVisites['demographie'],
  }))
}

async function lireJoursCrm(userId: string, depuis: string, jusqua: string): Promise<JourCrmVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.crmJour.findMany({ where: { userId, jour: { gte: new Date(depuis), lte: new Date(jusqua) } }, orderBy: { jour: 'asc' } }),
  )
  return lignes.map((ligne) => ({
    jour: jourIso(ligne.jour),
    prospects: ligne.prospects,
    clients: ligne.clients,
    canaux: (ligne.canaux ?? {}) as JourCrmVue['canaux'],
  }))
}

/** Les clics Google sur 28 jours au dernier relevé de la période, et 28 jours plus tôt. */
async function lireRecherche(userId: string, siteId: string, jusqua: string): Promise<Donnees['recherche']> {
  if (siteId === '') return null
  const dernier = await withUserScope(userId, (tx) =>
    tx.releveRecherche.findFirst({
      where: { userId, siteId, jour: { lte: new Date(jusqua) } },
      orderBy: { jour: 'desc' },
      select: { jour: true, clics: true },
    }),
  )
  if (dernier === null) return null
  const avant = await withUserScope(userId, (tx) =>
    tx.releveRecherche.findFirst({
      where: { userId, siteId, jour: { lte: new Date(+dernier.jour - 28 * JOUR_MS), gte: new Date(+dernier.jour - 35 * JOUR_MS) } },
      orderBy: { jour: 'desc' },
      select: { clics: true },
    }),
  )
  return { clics28: dernier.clics, clics28Avant: avant?.clics ?? null, au: jourIso(dernier.jour) }
}

function santeCompte(
  compte: CompteRelie | null,
  nom: string,
  cle: string,
  devise: string,
  maintenant: Date,
): LigneSante {
  const relier = { label: `Relier ${nom}`, href: '' }
  if (compte === null) return { cle, source: nom, etat: 'absent', texte: 'Non relié.', action: relier }
  if (compte.devise !== '' && devise !== '' && compte.devise !== devise) {
    return {
      cle,
      source: nom,
      etat: 'verifier',
      texte: `Compte tenu en ${compte.devise}, boutique en ${devise} : Nova ne mélange pas les devises, ses chiffres sont écartés des totaux.`,
      action: null,
    }
  }
  if (compte.synchroAt === null) return { cle, source: nom, etat: 'verifier', texte: 'Relié, pas encore synchronisé.', action: null }
  if (compte.plateforme === 'google-ads' && compte.conversionsActives === 0) {
    return {
      cle,
      source: nom,
      etat: 'probleme',
      texte: 'Aucune action de conversion n’est comptée dans ce compte : les ventes qu’il provoque sont invisibles pour lui.',
      action: null,
    }
  }
  if (+maintenant - +compte.synchroAt > VIEILLE_MS) {
    return {
      cle,
      source: nom,
      etat: 'verifier',
      texte: `Les dernières données ${nom.replace(' Ads', '')} disponibles datent du ${quandLisible(compte.synchroAt)}.`,
      action: null,
    }
  }
  return { cle, source: nom, etat: 'bon', texte: `À jour — synchronisé le ${quandLisible(compte.synchroAt)}.`, action: null }
}

function santeVentes(ventes: EtatVentes, maintenant: Date): LigneSante {
  const base = { cle: ventes.source, source: ventes.etat === 'absent' ? 'Ventes' : ventes.nom }
  const relier = { label: 'Relier une boutique ou Stripe', href: '' }
  switch (ventes.etat) {
    case 'absent':
      return { ...base, etat: 'absent', texte: 'Aucune source de ventes (Shopify, WooCommerce ou Stripe) : pas de chiffre d’affaires réel.', action: relier }
    case 'offre':
      return { ...base, etat: 'absent', texte: 'Votre offre n’ouvre pas la lecture de la boutique.', action: null }
    case 'portee':
      return { ...base, etat: 'probleme', texte: ventes.message, action: null }
    case 'jamais':
      return { ...base, etat: 'verifier', texte: 'Reliée, ventes pas encore lues. Actualisez pour les récupérer.', action: null }
    case 'erreur':
      return {
        ...base,
        etat: 'probleme',
        texte:
          ventes.synchroAt === null
            ? ventes.message
            : `${ventes.message} Les dernières données ${ventes.nom} disponibles datent du ${quandLisible(ventes.synchroAt)}.`,
        action: null,
      }
    case 'ok': {
      if (ventes.synchroAt !== null && +maintenant - +ventes.synchroAt > VIEILLE_MS) {
        return { ...base, etat: 'verifier', texte: `Les dernières données ${ventes.nom} disponibles datent du ${quandLisible(ventes.synchroAt)}.`, action: null }
      }
      if (ventes.tronque) {
        return { ...base, etat: 'verifier', texte: 'Trop de ventes pour une seule lecture : une partie de la période peut manquer.', action: null }
      }
      return {
        ...base,
        etat: 'bon',
        texte: `À jour${ventes.synchroAt === null ? '' : ` — lue le ${quandLisible(ventes.synchroAt)}`}${ventes.couvertureDepuis === null ? '' : `, ventes connues depuis le ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(ventes.couvertureDepuis))}`}.`,
        action: null,
      }
    }
  }
}

/** Les abonnements Stripe : lus, en panne, ou pas encore. `null` sans Stripe relié. */
function santeAbonnements(abonnements: EtatAbonnements, maintenant: Date): LigneSante | null {
  const base = { cle: 'stripe-abonnements', source: 'Abonnements Stripe', action: null }
  switch (abonnements.etat) {
    case 'absent':
      return null
    case 'jamais':
      return { ...base, etat: 'verifier', texte: 'Stripe relié, abonnements pas encore lus. Actualisez pour les récupérer.' }
    case 'erreur':
      return {
        ...base,
        etat: 'probleme',
        texte: abonnements.synchroAt === null ? abonnements.message : `${abonnements.message} Les derniers chiffres datent du ${quandLisible(abonnements.synchroAt)}.`,
      }
    case 'ok': {
      if (abonnements.synchroAt !== null && +maintenant - +abonnements.synchroAt > VIEILLE_MS) {
        return { ...base, etat: 'verifier', texte: `Les derniers chiffres datent du ${quandLisible(abonnements.synchroAt)}.` }
      }
      const autres = abonnements.instantane?.autresDevises ?? 0
      return {
        ...base,
        etat: abonnements.tronque || autres > 0 ? 'verifier' : 'bon',
        texte: abonnements.tronque
          ? 'Trop d’abonnements pour une seule lecture : les plus anciens peuvent manquer à l’historique.'
          : autres > 0
            ? `${autres} abonnement${autres > 1 ? 's' : ''} dans une autre devise, écarté${autres > 1 ? 's' : ''} des totaux.`
            : `À jour${abonnements.synchroAt === null ? '' : ` — lus le ${quandLisible(abonnements.synchroAt)}`}.`,
      }
    }
  }
}

/** Le coût des produits lu dans Shopify : de quoi calculer une marge réelle, ou ce qui manque. */
export function santeCouts(ventes: EtatVentes): LigneSante | null {
  if (ventes.etat !== 'ok' || ventes.couts.at === null) return null
  const base = { cle: 'couts', source: 'Coût des produits', action: null }
  if (ventes.couts.message !== '') return { ...base, etat: 'verifier', texte: ventes.couts.message }
  const { variantes, renseignes } = ventes.couts
  if (variantes === 0) return null
  const part = renseignes / variantes
  if (part >= 0.8) {
    return { ...base, etat: 'bon', texte: `Coût d’achat renseigné pour ${renseignes} variante${renseignes > 1 ? 's' : ''} sur ${variantes} : la marge est calculée sur vos coûts réels.` }
  }
  return {
    ...base,
    etat: 'verifier',
    texte: `Coût d’achat renseigné pour ${renseignes} variante${renseignes > 1 ? 's' : ''} sur ${variantes} seulement. Complétez « Coût par article » dans vos fiches Shopify pour une marge réelle.`,
  }
}

function santeVisites(visites: EtatVisites, maintenant: Date): LigneSante {
  const base = { cle: 'ga4', source: 'Google Analytics 4' }
  switch (visites.etat) {
    case 'absent':
      return { ...base, etat: 'absent', texte: 'Non relié : sans lui, ni visites ni taux de conversion.', action: { label: 'Connecter Google Analytics 4', href: '' } }
    case 'jamais':
      return { ...base, etat: 'verifier', texte: 'Relié, visites pas encore lues. Actualisez pour les récupérer.', action: null }
    case 'erreur':
      return {
        ...base,
        etat: 'probleme',
        texte: visites.synchroAt === null ? visites.message : `${visites.message} Les dernières données GA4 disponibles datent du ${quandLisible(visites.synchroAt)}.`,
        action: null,
      }
    case 'ok':
      if (visites.synchroAt !== null && +maintenant - +visites.synchroAt > VIEILLE_MS) {
        return { ...base, etat: 'verifier', texte: `Les dernières données GA4 disponibles datent du ${quandLisible(visites.synchroAt)}.`, action: null }
      }
      return { ...base, etat: 'bon', texte: `À jour — propriété « ${visites.nom} »${visites.synchroAt === null ? '' : `, lue le ${quandLisible(visites.synchroAt)}`}.`, action: null }
  }
}

/** Les incohérences entre GA4 et la boutique : c'est là que se voit un suivi cassé. */
function coherenceVisites(visites: CumulVisites | null, ventes: CumulVentes | null): LigneSante[] {
  if (visites === null) return []
  const lignes: LigneSante[] = []
  if (ventes !== null && ventes.commandes >= 10 && visites.achats === 0) {
    lignes.push({
      cle: 'ga4-achats',
      source: 'Événement d’achat GA4',
      etat: 'probleme',
      texte: `La boutique compte ${ventes.commandes} commandes, GA4 aucun achat : l’événement « purchase » n’arrive pas dans Analytics. Le suivi e-commerce est à vérifier.`,
      action: null,
      agent: 'audit',
    })
  } else if (ventes !== null && ventes.commandes >= 20 && visites.achats > 0) {
    const ecart = Math.abs(visites.achats - ventes.commandes) / ventes.commandes
    if (ecart >= 0.4) {
      lignes.push({
        cle: 'ga4-ecart',
        source: 'GA4 et boutique',
        etat: 'verifier',
        texte: `GA4 compte ${visites.achats} achats, la boutique ${ventes.commandes} commandes. Un écart de ${Math.round(ecart * 100)} % signale un suivi incomplet (bloqueurs, consentement, événement mal branché).`,
        action: null,
        agent: 'audit',
      })
    }
  }
  const sansCanal = visites.canaux.inconnu?.sessions ?? 0
  if (visites.sessions >= 200 && sansCanal / visites.sessions >= 0.2) {
    lignes.push({
      cle: 'ga4-non-attribue',
      source: 'Visites non attribuées',
      etat: 'verifier',
      texte: `${Math.round((sansCanal / visites.sessions) * 100)} % des visites n’ont pas de canal dans GA4 (« Unassigned »). Des liens sans paramètres UTM en sont souvent la cause.`,
      action: null,
      agent: 'audit',
    })
  }
  return lignes
}

/**
 * Pourquoi il n'y a pas de ventes, selon ce qui se passe réellement.
 *
 * « Connectez Shopify » à quelqu'un dont la boutique est reliée l'enverrait refaire une
 * connexion qui marche, alors que ce qui manque est une autorisation, ou un clic.
 */
export function raisonVentes(ventes: EtatVentes): string {
  switch (ventes.etat) {
    case 'absent':
      return MANQUE_VENTES
    case 'offre':
      return 'Votre offre n’ouvre pas la lecture de votre boutique.'
    case 'jamais':
      return 'Boutique reliée, ventes pas encore lues : cliquez « Actualiser ».'
    case 'portee':
    case 'erreur':
      return ventes.message === '' ? 'La lecture de votre boutique a échoué : cliquez « Actualiser ».' : ventes.message
    case 'ok':
      return 'Vos ventes ne sont connues que depuis le début de la lecture : choisissez une période plus courte.'
  }
}

/**
 * Tout ce que l'écran de Nova affiche, pour une période.
 *
 * Aucune écriture, aucun appel extérieur : une lecture de la base et du calcul.
 */
export async function lireNova(
  userId: string,
  locale: string,
  options: { periode?: string; du?: string; au?: string; siteId?: string } = {},
  maintenant = new Date(),
): Promise<VueNova> {
  const [ventes, google, meta, sites, visites, abonnements, crm] = await Promise.all([
    sans(lireEtatVentes(userId), ABSENT),
    sans(compteActif(userId, 'google-ads'), null),
    sans(compteActif(userId, 'meta-ads'), null),
    sans(listSites(userId), []),
    sans(lireEtatVisites(userId), { etat: 'absent', message: '', propriete: '', nom: '', synchroAt: null, couvertureDepuis: null, devise: '', fuseau: '' } as EtatVisites),
    sans(lireEtatAbonnements(userId), { etat: 'absent', message: '', synchroAt: null, tronque: false, instantane: null } as EtatAbonnements),
    sans(lireEtatCrm(userId), { etat: 'absent', message: '', synchroAt: null, couvertureDepuis: null, tronque: false, instantane: null } as EtatCrm),
  ])
  const indicateursAbos = abonnements.instantane === null ? null : indicateursAbonnements(abonnements.instantane)
  const lectureCrm = lireCrm(crm.instantane)
  const visitesLues = (visites.etat === 'ok' || (visites.etat === 'erreur' && visites.synchroAt !== null)) && visites.propriete !== ''
  const site = sites.find((un) => un.id === options.siteId) ?? sites[0] ?? null
  const siteId = site?.id ?? ''

  const venteLues = ventes.etat === 'ok' || (ventes.etat === 'erreur' && ventes.synchroAt !== null)
  const comptes = [google, meta].filter((compte): compte is CompteRelie => compte !== null)
  // La devise de la boutique fait référence : c'est elle qui encaisse.
  const devise = (venteLues && ventes.devise !== '' ? ventes.devise : comptes[0]?.devise) || 'CHF'
  const regies = comptes.filter((compte) => compte.devise === '' || compte.devise === devise)
  const fuseau = (venteLues ? ventes.fuseau : '') || comptes[0]?.fuseau || FUSEAU_DEFAUT

  const aujourdhui = jourDansFuseau(maintenant, fuseau)
  const periode = periodeDe(options.periode, aujourdhui, options.du, options.au)
  const precedente = periodePrecedente(periode)
  const reference = { du: decaler(periode.du, -30), au: decaler(periode.du, -1) }
  // Les objectifs se jugent sur le mois en cours et sur trente jours, quelle que soit la période affichée.
  const mois = moisCourant(fuseau, maintenant)
  const trente = periodeDe('30', aujourdhui)
  // Le mois précédent entier : c'est sur lui que se mesure le coût d'acquisition d'un abonné.
  const moisPrecedent = { du: decaler(mois.premier, -1).slice(0, 7) + '-01', au: decaler(mois.premier, -1) }
  // La surveillance compare hier aux 90 derniers jours : ils doivent être lus.
  const depuis = [precedente.du, reference.du, mois.premier, trente.du, moisPrecedent.du, decaler(aujourdhui, -90)].sort()[0]!
  const fin = [periode.au, trente.au].sort().at(-1)!

  const crmLu = crm.etat === 'ok' || (crm.etat === 'erreur' && crm.synchroAt !== null)
  const [campagnes, joursVentes, recherche, joursVisites, joursCrm] = await Promise.all([
    sans(lireCampagnes(userId, regies, depuis, fin), []),
    venteLues ? sans(lireVentes(userId, ventes.source, ventes.boutique, depuis, fin), []) : Promise.resolve([]),
    sans(lireRecherche(userId, siteId, periode.au), null),
    visitesLues ? sans(lireVisites(userId, visites.propriete, depuis, fin), []) : Promise.resolve([]),
    crmLu ? sans(lireJoursCrm(userId, depuis, fin), []) : Promise.resolve([]),
  ])
  const [reglages, prospects] = await Promise.all([sans(reglagesNova(userId), REGLAGES_VIDES), sans(prospectsNova(userId), undefined)])

  const donnees: Donnees = {
    devise,
    regies: regies.map((compte) => compte.plateforme as PlateformePayante),
    campagnes,
    ventes: { disponibles: venteLues, couvertureDepuis: ventes.couvertureDepuis, jours: joursVentes },
    nomVentes: ventes.nom,
    ...(prospects === undefined ? {} : { evenementsLeads: prospects }),
    crm: { disponibles: crmLu, couvertureDepuis: crm.couvertureDepuis, jours: joursCrm },
    recherche,
    visites: { disponibles: visitesLues, couvertureDepuis: visites.couvertureDepuis, jours: joursVisites },
  }

  const actuel = ensemble(donnees, periode)
  const avant = ensemble(donnees, precedente)
  const ventesActuelles = cumulVentes(donnees.ventes, periode)
  const ventesAvant = cumulVentes(donnees.ventes, precedente)
  const visitesActuelles = cumulVisites(donnees.visites, periode)
  const visitesAvant = cumulVisites(donnees.visites, precedente)
  const lignesAttribution = attribution(donnees, periode, ventesActuelles)
  const lignesCampagnes = performanceCampagnes(donnees, periode, precedente)
  const lignesProduits = performanceProduits(ventesActuelles, ventesAvant)

  const contexte = {
    donnees,
    bornes: periode,
    avant: precedente,
    reference,
    jours: periode.jours,
    ventes: ventesActuelles,
    ventesAvant,
    visites: visitesActuelles,
    visitesAvant,
    attribution: lignesAttribution,
    campagnes: lignesCampagnes,
    produits: lignesProduits,
    merEquilibre: null as number | null,
    abonnements: indicateursAbos,
    crm: lectureCrm,
  }
  // Le mois à date : le premier du mois, rien n'est encore écoulé, et zéro est alors la vérité.
  const ventesMois =
    mois.hier === null
      ? (venteLues ? cumulVentes(donnees.ventes, { du: mois.premier, au: mois.premier }) : null)
      : cumulVentes(donnees.ventes, { du: mois.premier, au: mois.hier })
  const trenteJours = ensemble(donnees, trente)
  const suivis = suivreObjectifs(reglages.objectifs, {
    mois: { joursEcoules: mois.joursEcoules, joursDuMois: mois.joursDuMois },
    ventesMois: mois.hier === null && ventesMois !== null ? { ...ventesMois, chiffre: 0, commandes: 0 } : ventesMois,
    roas30: regies.length === 0 ? null : enPourcent(trenteJours.pub.valeur, trenteJours.pub.depense),
    cac30:
      trenteJours.ventes === null || regies.length === 0 || trenteJours.ventes.nouveauxClients === 0 || trenteJours.pub.depense === 0
        ? null
        : Math.round((trenteJours.pub.depense / trenteJours.ventes.nouveauxClients) * 100) / 100,
  })
  const modeles = modelesAttribution(ventesActuelles)

  // Le coût d'acquisition d'un abonné, sur le dernier mois terminé.
  const moisAbos = abonnements.instantane?.serie.at(-2) ?? null
  const depenseMois = regies.length === 0 ? 0 : ensemble(donnees, moisPrecedent).pub.depense
  const acquisitionAbonnes: AcquisitionAbonnes | null =
    moisAbos === null || moisAbos.mois !== moisPrecedent.du.slice(0, 7) || moisAbos.nouveaux === 0 || depenseMois <= 0
      ? null
      : {
          mois: moisAbos.mois,
          depense: Math.round(depenseMois * 100) / 100,
          nouveaux: moisAbos.nouveaux,
          cac: Math.round((depenseMois / moisAbos.nouveaux) * 100) / 100,
          rentabiliseEnMois:
            indicateursAbos?.arpu == null || indicateursAbos.arpu === 0
              ? null
              : Math.round((depenseMois / moisAbos.nouveaux / indicateursAbos.arpu) * 10) / 10,
        }

  // Les prévisions lisent plus loin que la période : huit semaines, et l'an dernier s'il existe.
  const historique = venteLues ? await sans(lireVentes(userId, ventes.source, ventes.boutique, decaler(aujourdhui, -430), decaler(aujourdhui, -1)), []) : []
  const prevision = venteLues ? prevoirVentes(historique, aujourdhui, ventes.couvertureDepuis) : null

  const marge = margeEstimee(ventesActuelles, regies.length === 0 ? null : actuel.pub.depense, reglages.couts)
  contexte.merEquilibre = marge.etat === 'calculee' ? marge.merEquilibre : null
  const insights = detecterInsights(contexte)
  /*
   * Un objectif mensuel en retard est un constat comme un autre, et il passe devant : c'est
   * la personne qui l'a fixé, c'est donc ce qu'elle cherche en ouvrant l'écran.
   */
  for (const suivi of suivis) {
    if (suivi.tendance === 'en-retard' && suivi.projection !== null) {
      const unite = suivi.format === 'argent' ? `${devise} ` : ''
      const nombre = (valeur: number) => new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 }).format(valeur)
      insights.unshift({
        cle: `objectif.${suivi.cle}`,
        texte: `À ce rythme, ${suivi.label.toLowerCase()} finirait vers ${unite}${nombre(suivi.projection)}, pour un objectif de ${unite}${nombre(suivi.objectif)}.`,
        fondement: `${unite}${nombre(suivi.actuel ?? 0)} à date. ${suivi.commentaire}`,
        ton: 'attention',
      })
    } else if (suivi.tendance === 'hors-cible') {
      insights.unshift({
        cle: `objectif.${suivi.cle}`,
        texte: `${suivi.label} : objectif non tenu sur les 30 derniers jours.`,
        fondement: `${suivi.actuel ?? '—'}${suivi.format === 'pourcent' ? ' %' : ` ${devise}`} pour un objectif de ${suivi.objectif}${suivi.format === 'pourcent' ? ' %' : ` ${devise}`}.`,
        ton: 'attention',
      })
    }
  }
  insights.splice(5)
  const alertes = detecterAlertes(contexte)
  const opportunites = detecterOpportunites(contexte, locale, siteId)

  const connexions = `/${locale}/connexions`
  const lignesSante: LigneSante[] = [
    santeVentes(ventes, maintenant),
    santeCompte(google, 'Google Ads', 'google-ads', venteLues ? devise : '', maintenant),
    santeCompte(meta, 'Meta Ads', 'meta-ads', venteLues ? devise : '', maintenant),
    recherche === null
      ? { cle: 'search-console', source: 'Search Console', etat: 'absent', texte: siteId === '' ? 'Aucun site analysé.' : 'Aucun relevé de recherche pour ce site.', action: { label: 'Relier Search Console', href: connexions } }
      : { cle: 'search-console', source: 'Search Console', etat: 'bon', texte: `Relevé du ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(recherche.au))}.`, action: null },
    santeVisites(visites, maintenant),
  ]
  const couts = santeCouts(ventes)
  if (couts !== null) lignesSante.push(couts)
  const santeAbos = santeAbonnements(abonnements, maintenant)
  if (santeAbos !== null) lignesSante.push(santeAbos)
  if (crm.etat !== 'absent') {
    lignesSante.push(
      crm.etat === 'jamais'
        ? { cle: 'crm', source: 'HubSpot', etat: 'verifier', texte: 'Relié, pas encore lu. Actualisez pour récupérer vos prospects.', action: null }
        : crm.etat === 'erreur'
          ? { cle: 'crm', source: 'HubSpot', etat: 'probleme', texte: crm.synchroAt === null ? crm.message : `${crm.message} Les derniers chiffres datent du ${quandLisible(crm.synchroAt)}.`, action: null }
          : {
              cle: 'crm',
              source: 'HubSpot',
              etat: crm.tronque ? 'verifier' : 'bon',
              texte: crm.tronque
                ? 'Plus de dix mille contacts sur la période : HubSpot n’en rend pas davantage, les plus récents peuvent manquer.'
                : `À jour${crm.synchroAt === null ? '' : ` — lu le ${quandLisible(crm.synchroAt)}`}.`,
              action: null,
            },
    )
  }
  if (ventesActuelles !== null && ventesActuelles.commandes >= 20) {
    const inconnues = (ventesActuelles.canaux.inconnu?.commandes ?? 0) / ventesActuelles.commandes
    if (inconnues >= 0.3) {
      lignesSante.push({
        cle: 'non-attribue',
        source: 'Trafic non attribué',
        etat: 'verifier',
        texte: `${Math.round(inconnues * 100)} % des commandes n’ont pas d’origine connue. Des liens sans paramètres UTM en sont souvent la cause.`,
        action: null,
        agent: 'audit',
      })
    }
  }
  lignesSante.push(...coherenceVisites(visitesActuelles, ventesActuelles))
  if (lignesAttribution.reel !== null && lignesAttribution.reel.chiffre > 0 && lignesAttribution.revendique > lignesAttribution.reel.chiffre * 1.3) {
    lignesSante.push({
      cle: 'doublons',
      source: 'Conversions en double',
      etat: 'verifier',
      texte: 'Les régies revendiquent nettement plus de revenu que la boutique n’en encaisse : des ventes sont probablement comptées deux fois.',
      action: null,
      agent: 'audit',
    })
  }
  for (const controle of controlesSuivi({
    ventes: ventesActuelles,
    regies: donnees.regies,
    pub: (plateforme) => cumulPub(donnees.campagnes, periode, (ligne) => ligne.plateforme === plateforme),
  })) {
    lignesSante.push({ ...controle, action: null })
  }
  for (const ligne of lignesSante) {
    if (ligne.action !== null && ligne.action.href === '') ligne.action = { ...ligne.action, href: connexions }
  }
  const etats = lignesSante.map((ligne) => ligne.etat)
  const global = etats.includes('probleme') ? 'probleme' : etats.includes('verifier') || !etats.includes('bon') ? 'verifier' : 'bon'

  const sources = [
    ...(venteLues ? [ventes.nom] : []),
    ...regies.map((compte) => NOM_CANAL[compte.plateforme as PlateformePayante]),
    ...(recherche === null ? [] : ['Search Console']),
    ...(visitesLues ? ['Google Analytics 4'] : []),
    ...(abonnements.instantane !== null && ventes.source !== 'stripe' ? ['Stripe (abonnements)'] : []),
    ...(crmLu && ventes.source !== 'hubspot' ? ['HubSpot'] : []),
  ]

  return {
    periode,
    precedente,
    devise,
    vierge:
      ventes.etat === 'absent' && comptes.length === 0 && recherche === null && visites.etat === 'absent' && abonnements.etat === 'absent' && crm.etat === 'absent',
    sources,
    kpis: indicateursNova(actuel, avant, raisonVentes(ventes), ventes.nom),
    canaux: performanceCanaux(donnees, periode, ventesActuelles, visitesActuelles, actuel.leads ?? null, actuel.crm ?? null),
    attribution: lignesAttribution,
    campagnes: lignesCampagnes.slice(0, CAMPAGNES_MAX),
    produits: lignesProduits.slice(0, PRODUITS_MAX),
    insights,
    alertes,
    opportunites,
    sante: { global, lignes: lignesSante },
    ventes,
    visites,
    visitesPeriode: visitesActuelles,
    contenus: contenusQuiAttirent(visitesActuelles),
    leads: actuel.leads ?? null,
    crm,
    lectureCrm,
    abonnements: { etat: abonnements, indicateurs: indicateursAbos, acquisition: acquisitionAbonnes },
    audiences: lireAudiences(visitesActuelles),
    prevision,
    surveillance: surveillance(donnees, decaler(aujourdhui, -1), ventes.nom),
    manqueVentes: ventesActuelles === null ? raisonVentes(ventes) : '',
    /*
     * La période affichée est couverte, la précédente non : sans cette phrase, « pas de
     * comparaison » sur chaque carte laisserait croire à une panne.
     */
    sansComparaison:
      ventesActuelles !== null && ventesAvant === null && ventes.couvertureDepuis !== null
        ? `Ventes connues depuis le ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(ventes.couvertureDepuis))} : la période précédente commence avant, elle n’est donc pas comparée.${ventes.source === 'shopify' ? ' Sans l’autorisation « read_all_orders », Shopify ne donne que les 60 derniers jours ; avec elle, tout l’historique.' : ''}`
        : null,
    pourOria: rapportPourOria(periode.libelle, sources, alertes, insights, opportunites),
    siteId,
    reglages,
    ordre: ordreIndicateurs(reglages.activite),
    aVenir: indicateursAVenir(reglages.activite, abonnements.etat !== 'absent', crm.etat !== 'absent'),
    marge,
    objectifs: suivis,
    clients: repartitionClients(ventesActuelles),
    valeurClient: valeurClient(ventes.clients),
    modeles,
    parcours: lectureParcours(modeles),
  }
}
