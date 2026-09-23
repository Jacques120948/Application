import { withUserScope } from '@/server/db/scope'
import { lireNova } from '@/server/nova/service'
import { reglagesNova, type Activite } from '@/server/nova/reglages'
import { lireEtatLina, type EtatLina, type PaniersLina } from './collecte'
import { criteresLina, type Criteres } from './criteres'
import {
  argent,
  campagnes as recommanderCampagnes,
  insights as detecter,
  nombreLisible,
  quickWins as gainsRapides,
  santeCrm,
  type Campagne,
  type InsightLina,
  type LigneSanteCrm,
} from './recommandations'
import {
  contexteSegments,
  indicateurs as calculerIndicateurs,
  membresSegment,
  rfm as calculerRfm,
  segmenter,
  type ClientIndex,
  type CleSegment,
  type Indicateurs,
  type LigneRfm,
  type Segment,
} from './segments'

/**
 * La vue de Lina : tout ce que son écran, sa conversation et Oria lisent.
 *
 * **Rien ici ne coûte un crédit ni n'appelle Shopify.** L'index des clients est relu en
 * base et segmenté par du code à chaque ouverture — c'est ce qui permet de changer un seuil
 * et de voir aussitôt les segments bouger, sans relire la boutique.
 */

/** Ce que Nova sait et que Lina reprend sans le recalculer. */
export type DepuisNova = {
  /** Coût d'acquisition d'un nouveau client sur trente jours, en unités de la devise. */
  cac: number | null
  chiffre30: number | null
  devise: string
}

export type VueLina = {
  etat: EtatLina
  criteres: Criteres
  activite: Activite | ''
  devise: string
  /** Vrai tant qu'aucun client n'a été lu : l'écran accueille au lieu d'afficher des zéros. */
  vierge: boolean
  indicateurs: Indicateurs | null
  segments: Segment[]
  rfm: LigneRfm[] | null
  campagnes: Campagne[]
  insights: InsightLina[]
  quickWins: { cle: string; texte: string }[]
  sante: LigneSanteCrm[]
  paniers: PaniersLina | null
  topSegment: Segment | null
  nova: DepuisNova | null
  /** Les phrases transmises à Oria : des opportunités chiffrées, rien d'autre. */
  pourOria: string[]
}

async function lireClients(userId: string): Promise<(ClientIndex & { devise: string })[]> {
  return withUserScope(userId, (tx) =>
    tx.linaClient.findMany({
      where: { userId },
      select: { ref: true, creeLe: true, derniereCommande: true, commandes: true, caCents: true, consentement: true, devise: true },
    }),
  )
}

async function depuisNova(userId: string): Promise<DepuisNova | null> {
  const vue = await lireNova(userId, 'fr', { periode: '30' }).catch(() => null)
  if (vue === null || vue.vierge) return null
  const valeur = (cle: string) => vue.kpis.find((kpi) => kpi.cle === cle)?.valeur ?? null
  return { cac: valeur('cac'), chiffre30: valeur('chiffre'), devise: vue.devise }
}

/** Les opportunités transmises à Oria, écrites comme Lina les dirait. */
export function pourOria(campagnes: readonly Campagne[], segments: readonly Segment[], devise: string): string[] {
  return campagnes.slice(0, 3).map((campagne) => {
    const segment = segments.find((un) => un.cle === campagne.segment)
    const historique = segment === undefined || segment.caCents === 0 ? '' : ` représentant ${argent(segment.caCents, devise)} de CA historique`
    return `${campagne.titre} : ${nombreLisible(campagne.audience)} ${campagne.audienceLibelle}${historique}. Impact ${campagne.impact === 'eleve' ? 'élevé' : campagne.impact}, effort ${campagne.effort}.`
  })
}

/**
 * `avecNova` : Oria lit déjà Nova de son côté ; lui faire relire Nova à travers Lina
 * doublerait le calcul pour rien.
 */
export async function lireLina(userId: string, options: { avecNova?: boolean; maintenant?: Date } = {}): Promise<VueLina> {
  const maintenant = options.maintenant ?? new Date()
  const [etat, criteres, reglages] = await Promise.all([lireEtatLina(userId), criteresLina(userId), reglagesNova(userId)])
  const lue = etat.synchroAt !== null
  const [clients, nova] = await Promise.all([
    lue ? lireClients(userId) : Promise.resolve([]),
    options.avecNova === false ? Promise.resolve(null) : depuisNova(userId),
  ])
  const devise = clients.find((client) => client.devise !== '')?.devise ?? etat.paniers?.devise ?? nova?.devise ?? ''
  const vide: VueLina = {
    etat,
    criteres,
    activite: reglages.activite,
    devise,
    vierge: true,
    indicateurs: null,
    segments: [],
    rfm: null,
    campagnes: [],
    insights: [],
    quickWins: [],
    sante: [],
    paniers: etat.paniers,
    topSegment: null,
    nova,
    pourOria: [],
  }
  if (!lue) return vide

  const contexte = contexteSegments(clients, criteres, maintenant)
  const segments = segmenter(clients, contexte, etat.consentement, devise)
  const indicateurs = calculerIndicateurs(clients, segments, etat.consentement)
  const campagnes = recommanderCampagnes(segments, indicateurs, etat.paniers, criteres, devise)
  const plusAncien = clients.reduce<Date | null>((min, client) => (min === null || client.creeLe < min ? client.creeLe : min), null)
  return {
    ...vide,
    vierge: false,
    indicateurs,
    segments,
    rfm: calculerRfm(clients, maintenant),
    campagnes,
    insights: detecter(segments, indicateurs, etat.paniers, criteres, devise),
    quickWins: gainsRapides(campagnes),
    sante: santeCrm(segments, indicateurs, etat.paniers, {
      clients: clients.length,
      tronque: etat.tronque,
      consentement: etat.consentement,
      plusAncien,
      maintenant,
    }),
    topSegment: segments.find((segment) => segment.cle === campagnes[0]?.segment) ?? null,
    pourOria: pourOria(campagnes, segments, devise),
  }
}

export type MembreVu = {
  ref: string
  commandes: number
  caCents: number
  derniereCommande: string | null
  consentement: string
}

/** Les clients d'un segment, les plus gros d'abord — des identifiants, pas des personnes. */
export async function lireMembres(userId: string, cle: CleSegment, limite = 50, maintenant = new Date()): Promise<MembreVu[]> {
  const [clients, criteres] = await Promise.all([lireClients(userId), criteresLina(userId)])
  const contexte = contexteSegments(clients, criteres, maintenant)
  return membresSegment(clients, cle, contexte, limite).map((client) => ({
    ref: client.ref,
    commandes: client.commandes,
    caCents: client.caCents,
    derniereCommande: client.derniereCommande === null ? null : client.derniereCommande.toISOString().slice(0, 10),
    consentement: client.consentement,
  }))
}
