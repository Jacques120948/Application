import { withUserScope } from '@/server/db/scope'
import { lireNova } from '@/server/nova/service'
import { reglagesNova, type Activite } from '@/server/nova/reglages'
import { lireEtatLina, type EtatLina, type PaniersLina } from './collecte'
import { criteresLina, type Criteres } from './criteres'
import type { AnalyseCommandes, ProduitAnalyse } from './commandes'
import {
  audiencesPub,
  campagnesProduits,
  produitPrincipalSegment,
  programmeFidelite,
  reachatParProduit,
  risquesDepart,
  scenarios,
  suggestions,
  valeurClient,
  type AudiencePub,
  type NiveauRisque,
  type PalierFidelite,
  type ReachatProduit,
  type Scenario,
  type SuggestionProduit,
  type ValeurClient,
} from './valeur'
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
  /** V2 : ce que les commandes ont appris. `null` tant qu'elles n'ont pas été lues. */
  analyse: AnalyseCommandes | null
  produits: ProduitAnalyse[]
  reachat: ReachatProduit[]
  croisees: SuggestionProduit[]
  montees: SuggestionProduit[]
  valeur: ValeurClient | null
  risques: NiveauRisque[]
  fidelite: PalierFidelite[]
  audiences: AudiencePub[]
  scenarios: Scenario[]
  /** Le produit le plus acheté par les clients à réactiver et par les dormants. */
  produitsSegments: Partial<Record<CleSegment, string>>
}

async function lireClients(userId: string): Promise<(ClientIndex & { devise: string })[]> {
  return withUserScope(userId, (tx) =>
    tx.linaClient.findMany({
      where: { userId },
      select: {
        ref: true,
        creeLe: true,
        derniereCommande: true,
        commandes: true,
        caCents: true,
        consentement: true,
        devise: true,
        premiereCommande: true,
        intervalleJours: true,
        produitPrincipal: true,
      },
    }),
  )
}

async function lireProduits(userId: string): Promise<ProduitAnalyse[]> {
  const lignes = await withUserScope(userId, (tx) => tx.linaProduit.findMany({ where: { userId }, orderBy: { caCents: 'desc' } }))
  return lignes.map(({ ref, titre, type, acheteurs, reacheteurs, commandes, caCents, prixMoyenCents, intervalleMedian, intervalleP25, intervalleP75 }) => ({
    ref,
    titre,
    type,
    acheteurs,
    reacheteurs,
    commandes,
    caCents,
    prixMoyenCents,
    intervalleMedian,
    intervalleP25,
    intervalleP75,
  }))
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
    analyse: etat.analyse,
    produits: [],
    reachat: [],
    croisees: [],
    montees: [],
    valeur: null,
    risques: [],
    fidelite: [],
    audiences: [],
    scenarios: [],
    produitsSegments: {},
  }
  if (!lue) return vide

  const contexte = contexteSegments(clients, criteres, maintenant)
  const segments = segmenter(clients, contexte, etat.consentement, devise)
  const indicateurs = calculerIndicateurs(clients, segments, etat.consentement)
  const produits = etat.analyse === null ? [] : await lireProduits(userId)
  const reachat = reachatParProduit(produits)
  const montees = etat.analyse === null ? [] : suggestions(etat.analyse.montees, produits, etat.analyse.ensemble, true)
  // Une montée en gamme se dit comme telle : elle ne revient pas parmi les produits complémentaires.
  const enMontee = new Set(montees.map((un) => `${un.de.ref}>${un.vers.ref}`))
  const croisees =
    etat.analyse === null
      ? []
      : suggestions(etat.analyse.suivants, produits, etat.analyse.ensemble, false).filter((un) => !enMontee.has(`${un.de.ref}>${un.vers.ref}`))
  /*
   * Les campagnes de la V1 et celles que les produits rendent possibles, classées ensemble :
   * potentiel divisé par l'effort. Chaque liste a calculé son impact par rapport à la sienne ;
   * le classement, lui, est commun.
   */
  const poids = { faible: 1, moyen: 2, eleve: 3 } as const
  const campagnes = [
    ...recommanderCampagnes(segments, indicateurs, etat.paniers, criteres, devise),
    ...campagnesProduits(reachat, croisees, montees, produits, devise),
  ].sort((a, b) => b.potentielCents / poids[b.effort] - a.potentielCents / poids[a.effort])
  const paniersRestants = etat.paniers === null || etat.paniers.erreur !== undefined ? null : etat.paniers.courant.nombre - etat.paniers.courant.recuperes
  const produitsSegments: Partial<Record<CleSegment, string>> = {}
  for (const cle of ['a-reactiver', 'dormants', 'vip', 'a-risque'] as const) {
    const titre = produitPrincipalSegment(clients, cle, contexte, produits)
    if (titre !== null) produitsSegments[cle] = titre
  }
  const plusAncien = clients.reduce<Date | null>((min, client) => (min === null || client.creeLe < min ? client.creeLe : min), null)
  return {
    ...vide,
    vierge: false,
    indicateurs,
    segments,
    rfm: calculerRfm(clients, maintenant),
    campagnes,
    insights: [
      ...detecter(segments, indicateurs, etat.paniers, criteres, devise),
      ...(reachat[0] === undefined ? [] : [{ cle: 'reachat-produit', texte: `« ${reachat[0].titre} » est le produit le plus racheté : ${reachat[0].p25} à ${reachat[0].p75} jours entre deux achats.` }]),
    ].slice(0, 5),
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
    produits,
    reachat,
    croisees,
    montees,
    valeur: valeurClient(clients, maintenant),
    risques: risquesDepart(clients, contexte),
    fidelite: programmeFidelite(segments, clients, criteres),
    audiences: audiencesPub(segments),
    scenarios: scenarios(segments, reachat, paniersRestants, criteres),
    produitsSegments,
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
