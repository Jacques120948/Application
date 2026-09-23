import type { Criteres } from './criteres'

/**
 * Le moteur de segmentation de Lina. Pur : des clients et des seuils en entrée, des
 * segments en sortie, sans base ni horloge — c'est ce qui le rend testable et c'est ce qui
 * garantit qu'aucun chiffre ne vient d'un modèle.
 *
 * Un client appartient à plusieurs segments à la fois : un VIP peut être fidèle et actif.
 * Les segments ne s'additionnent donc pas, et l'écran ne les présente jamais comme une
 * répartition.
 */

export const JOUR_MS = 24 * 60 * 60 * 1000

/** Ce que Lina sait d'un client : rien qui dise qui il est. */
export type ClientIndex = {
  ref: string
  creeLe: Date
  derniereCommande: Date | null
  commandes: number
  caCents: number
  consentement: string
  /** V2, quand les commandes ont été lues : la vraie première commande et le rythme habituel. */
  premiereCommande?: Date | null
  intervalleJours?: number | null
  produitPrincipal?: string | null
}

export const CLES_SEGMENTS = [
  'nouveaux',
  'actifs',
  'recurrents',
  'fideles',
  'vip',
  'fort-panier',
  'une-fois',
  'a-risque',
  'a-reactiver',
  'dormants',
  'sans-commande',
] as const

export type CleSegment = (typeof CLES_SEGMENTS)[number]

/** En dessous, un segment est trop petit pour en tirer une règle ; il reste affiché, signalé. */
export const SEGMENT_MIN = 20
/** En dessous, les seuils relatifs (VIP, fort panier, RFM) ne veulent rien dire. */
export const ACHETEURS_MIN_RELATIFS = 20
export const ACHETEURS_MIN_RFM = 50

export type Segment = {
  cle: CleSegment
  nom: string
  critere: string
  nombre: number
  caCents: number
  commandes: number
  panierMoyenCents: number | null
  /** Part du chiffre d'affaires de tous les clients. */
  partCa: number | null
  /** Jours depuis la dernière commande, médiane du segment. */
  joursMedian: number | null
  /** Clients qui acceptent les courriels marketing. `null` : consentement non lu. */
  contactables: number | null
  tropPetit: boolean
  /** La même sélection, à coller dans Shopify (Clients → Segments). `null` : inexprimable. */
  requeteShopify: string | null
}

export type ContexteSegments = {
  criteres: Criteres
  maintenant: Date
  /** CA minimal d'un VIP ; `null` quand il y a trop peu d'acheteurs pour le dire. */
  seuilVipCents: number | null
  /** Panier moyen minimal d'un client « fort panier ». */
  seuilFortPanierCents: number | null
}

export function jours(depuis: Date, maintenant: Date): number {
  return Math.max(0, Math.floor((+maintenant - +depuis) / JOUR_MS))
}

/** Le quantile d'une liste triée croissante (0 ≤ q ≤ 1). */
function quantile(tries: readonly number[], q: number): number {
  if (tries.length === 0) return 0
  const position = Math.min(tries.length - 1, Math.max(0, Math.ceil(q * tries.length) - 1))
  return tries[position]!
}

export function contexteSegments(clients: readonly ClientIndex[], criteres: Criteres, maintenant: Date): ContexteSegments {
  const acheteurs = clients.filter((client) => client.commandes > 0)
  if (acheteurs.length < ACHETEURS_MIN_RELATIFS) return { criteres, maintenant, seuilVipCents: null, seuilFortPanierCents: null }
  // Les VIP sont les k plus gros clients, k = la part demandée, arrondie vers le bas : un seuil
  // pris un rang trop bas ferait entrer tout un palier d'ex æquo.
  const ca = acheteurs.map((client) => client.caCents).sort((a, b) => b - a)
  const k = Math.max(1, Math.floor(acheteurs.length * criteres.vipPart))
  const paniers = acheteurs.map((client) => client.caCents / client.commandes).sort((a, b) => a - b)
  return {
    criteres,
    maintenant,
    seuilVipCents: Math.max(1, ca[k - 1]!),
    seuilFortPanierCents: Math.max(1, Math.round(quantile(paniers, 0.8))),
  }
}

/**
 * L'écart habituel entre deux commandes d'un client, estimé. La fiche est créée, dans
 * l'immense majorité des cas, à la première commande : l'écart est donc la durée entre la
 * création et la dernière commande, divisée par le nombre d'intervalles.
 */
export function intervalleEstime(client: ClientIndex): number | null {
  if (client.commandes < 2 || client.derniereCommande === null) return null
  // Le rythme lu dans les commandes vaut mieux que l'estimation par la date de création.
  if (client.intervalleJours != null) return Math.max(7, client.intervalleJours)
  return Math.max(7, (+client.derniereCommande - +client.creeLe) / JOUR_MS / (client.commandes - 1))
}

export function appartient(client: ClientIndex, cle: CleSegment, contexte: ContexteSegments): boolean {
  const { criteres, maintenant } = contexte
  if (cle === 'sans-commande') return client.commandes === 0
  if (client.commandes === 0 || client.derniereCommande === null) return false
  const depuis = jours(client.derniereCommande, maintenant)
  switch (cle) {
    case 'nouveaux':
      return jours(client.premiereCommande ?? client.creeLe, maintenant) <= criteres.nouveauJours
    case 'actifs':
      return depuis <= criteres.actifJours
    case 'recurrents':
      return client.commandes >= 2
    case 'fideles':
      return client.commandes >= criteres.fideleCommandes && depuis <= criteres.actifJours
    case 'vip':
      return contexte.seuilVipCents !== null && client.commandes >= 2 && client.caCents >= contexte.seuilVipCents
    case 'fort-panier':
      return contexte.seuilFortPanierCents !== null && client.caCents / client.commandes >= contexte.seuilFortPanierCents
    case 'une-fois':
      return client.commandes === 1
    case 'a-risque': {
      // Un client régulier dont le silence dépasse deux fois son rythme habituel.
      const intervalle = intervalleEstime(client)
      return intervalle !== null && depuis <= criteres.dormantJours && depuis > Math.max(2 * intervalle, 30)
    }
    case 'a-reactiver':
      return depuis > criteres.actifJours && depuis <= criteres.dormantJours
    case 'dormants':
      return depuis > criteres.dormantJours
  }
}

function montantShopify(cents: number): string {
  return String(Math.floor(cents / 100))
}

function description(cle: CleSegment, contexte: ContexteSegments, devise: string): { nom: string; critere: string; requete: string | null } {
  const { criteres } = contexte
  switch (cle) {
    case 'nouveaux':
      return { nom: 'Nouveaux clients', critere: `Premier achat il y a ${criteres.nouveauJours} jours au plus`, requete: `first_order_date > -${criteres.nouveauJours}d` }
    case 'actifs':
      return { nom: 'Clients actifs', critere: `Dernière commande il y a ${criteres.actifJours} jours au plus`, requete: `last_order_date > -${criteres.actifJours}d` }
    case 'recurrents':
      return { nom: 'Clients récurrents', critere: 'Au moins deux commandes', requete: 'number_of_orders >= 2' }
    case 'fideles':
      return {
        nom: 'Clients fidèles',
        critere: `Au moins ${criteres.fideleCommandes} commandes, et actifs`,
        requete: `number_of_orders >= ${criteres.fideleCommandes} AND last_order_date > -${criteres.actifJours}d`,
      }
    case 'vip':
      return {
        nom: 'VIP',
        critere:
          contexte.seuilVipCents === null
            ? 'Trop peu d’acheteurs pour les distinguer'
            : `Les ${Math.round(criteres.vipPart * 100)} % qui dépensent le plus (dès ${devise} ${montantShopify(contexte.seuilVipCents)}), au moins deux commandes`,
        requete: contexte.seuilVipCents === null ? null : `amount_spent >= ${montantShopify(contexte.seuilVipCents)} AND number_of_orders >= 2`,
      }
    case 'fort-panier':
      return {
        nom: 'Clients à fort panier',
        critere:
          contexte.seuilFortPanierCents === null
            ? 'Trop peu d’acheteurs pour les distinguer'
            : `Panier moyen parmi les 20 % les plus élevés (dès ${devise} ${montantShopify(contexte.seuilFortPanierCents)})`,
        requete: null,
      }
    case 'une-fois':
      return { nom: 'Une seule commande', critere: 'Exactement une commande', requete: 'number_of_orders = 1' }
    case 'a-risque':
      return {
        nom: 'Clients à risque',
        critere: 'Clients réguliers dont le silence dépasse deux fois leur rythme habituel — risque estimé',
        requete: null,
      }
    case 'a-reactiver':
      return {
        nom: 'À réactiver',
        critere: `Dernière commande il y a ${criteres.actifJours} à ${criteres.dormantJours} jours`,
        requete: `last_order_date BETWEEN -${criteres.dormantJours}d AND -${criteres.actifJours}d`,
      }
    case 'dormants':
      return { nom: 'Clients dormants', critere: `Aucune commande depuis plus de ${criteres.dormantJours} jours`, requete: `last_order_date < -${criteres.dormantJours}d` }
    case 'sans-commande':
      return { nom: 'Inscrits sans commande', critere: 'Une fiche client, aucune commande', requete: 'number_of_orders = 0' }
  }
}

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null
  const tries = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(tries.length / 2)
  return tries.length % 2 === 1 ? tries[milieu]! : Math.round((tries[milieu - 1]! + tries[milieu]!) / 2)
}

export function segmenter(
  clients: readonly ClientIndex[],
  contexte: ContexteSegments,
  consentementLu: boolean,
  devise: string,
): Segment[] {
  const caTotal = clients.reduce((total, client) => total + client.caCents, 0)
  return CLES_SEGMENTS.map((cle) => {
    const membres = clients.filter((client) => appartient(client, cle, contexte))
    const caCents = membres.reduce((total, client) => total + client.caCents, 0)
    const commandes = membres.reduce((total, client) => total + client.commandes, 0)
    const { nom, critere, requete } = description(cle, contexte, devise)
    return {
      cle,
      nom,
      critere,
      nombre: membres.length,
      caCents,
      commandes,
      panierMoyenCents: commandes === 0 ? null : Math.round(caCents / commandes),
      partCa: caTotal === 0 || cle === 'sans-commande' ? null : caCents / caTotal,
      joursMedian: mediane(membres.flatMap((client) => (client.derniereCommande === null ? [] : [jours(client.derniereCommande, contexte.maintenant)]))),
      contactables: consentementLu ? membres.filter((client) => client.consentement === 'oui').length : null,
      tropPetit: membres.length > 0 && membres.length < SEGMENT_MIN,
      requeteShopify: requete,
    }
  })
}

/** Les membres d'un segment, les plus gros clients d'abord : ceux qu'on regarde en premier. */
export function membresSegment(clients: readonly ClientIndex[], cle: CleSegment, contexte: ContexteSegments, limite: number): ClientIndex[] {
  return clients
    .filter((client) => appartient(client, cle, contexte))
    .sort((a, b) => b.caCents - a.caCents)
    .slice(0, limite)
}

export type Indicateurs = {
  /** Clients qui ont commandé au moins une fois. */
  acheteurs: number
  actifs: number
  nouveaux: number
  recurrents: number
  /** Part des acheteurs qui ont commandé au moins deux fois. */
  tauxReachat: number | null
  panierMoyenCents: number | null
  aReactiver: number
  dormants: number
  caTotalCents: number
  caRecurrentsCents: number
  partCaRecurrents: number | null
  sansCommande: number
  /** `null` : le consentement n'a pas pu être lu. */
  contactables: number | null
  sansEmail: number | null
}

export function indicateurs(clients: readonly ClientIndex[], segments: readonly Segment[], consentementLu: boolean): Indicateurs {
  const trouver = (cle: CleSegment) => segments.find((segment) => segment.cle === cle)!
  const acheteurs = clients.filter((client) => client.commandes > 0)
  const commandes = acheteurs.reduce((total, client) => total + client.commandes, 0)
  const caTotal = acheteurs.reduce((total, client) => total + client.caCents, 0)
  const recurrents = trouver('recurrents')
  return {
    acheteurs: acheteurs.length,
    actifs: trouver('actifs').nombre,
    nouveaux: trouver('nouveaux').nombre,
    recurrents: recurrents.nombre,
    tauxReachat: acheteurs.length === 0 ? null : recurrents.nombre / acheteurs.length,
    panierMoyenCents: commandes === 0 ? null : Math.round(caTotal / commandes),
    aReactiver: trouver('a-reactiver').nombre,
    dormants: trouver('dormants').nombre,
    caTotalCents: caTotal,
    caRecurrentsCents: recurrents.caCents,
    partCaRecurrents: caTotal === 0 ? null : recurrents.caCents / caTotal,
    sansCommande: trouver('sans-commande').nombre,
    contactables: consentementLu ? clients.filter((client) => client.consentement === 'oui').length : null,
    sansEmail: consentementLu ? clients.filter((client) => client.consentement === 'sans-email').length : null,
  }
}

// ── RFM ─────────────────────────────────────────────────────────────────────

export const CLASSES_RFM = ['champions', 'fideles', 'potentiel-vip', 'a-reactiver', 'a-risque', 'dormants', 'recents'] as const
export type ClasseRfm = (typeof CLASSES_RFM)[number]

export const NOM_CLASSE_RFM: Record<ClasseRfm, string> = {
  champions: 'Champions',
  fideles: 'Clients fidèles',
  'potentiel-vip': 'Potentiel VIP',
  'a-reactiver': 'À réactiver',
  'a-risque': 'À risque',
  dormants: 'Dormants',
  recents: 'Récents occasionnels',
}

export type LigneRfm = { cle: ClasseRfm; nom: string; nombre: number; caCents: number; partCa: number | null }

/** Un score de 1 à 5 selon des seuils croissants : au-delà du n-ième seuil, n + 1. */
function score(valeur: number, seuils: readonly number[]): number {
  let resultat = 1
  for (const seuil of seuils) if (valeur > seuil) resultat += 1
  return Math.min(5, resultat)
}

/**
 * Le score RFM : récence, fréquence, montant, chacun de 1 à 5.
 *
 * Récence et montant se notent par quintiles de la boutique elle-même — un « gros » client
 * n'a pas le même montant chez un fleuriste et chez un bijoutier. La fréquence, elle, se
 * note par paliers fixes : dans une boutique où la plupart des clients n'ont commandé
 * qu'une fois, des quintiles de fréquence ne distingueraient personne.
 */
export function scoresRfm(client: ClientIndex, seuilsRecence: readonly number[], seuilsMontant: readonly number[], maintenant: Date) {
  const depuis = client.derniereCommande === null ? Number.POSITIVE_INFINITY : jours(client.derniereCommande, maintenant)
  const r = 6 - score(depuis, seuilsRecence)
  const f = client.commandes >= 6 ? 5 : client.commandes >= 4 ? 4 : Math.max(1, client.commandes)
  const m = score(client.caCents, seuilsMontant)
  return { r, f, m }
}

export function classeRfm({ r, f, m }: { r: number; f: number; m: number }): ClasseRfm {
  if (r >= 4 && f >= 4) return 'champions'
  if (r >= 3 && f >= 3) return 'fideles'
  if (r >= 4 && m >= 4) return 'potentiel-vip'
  if (r <= 2 && f >= 3) return 'a-risque'
  if (r === 1) return 'dormants'
  if (r >= 4) return 'recents'
  return 'a-reactiver'
}

export function rfm(clients: readonly ClientIndex[], maintenant: Date): LigneRfm[] | null {
  const acheteurs = clients.filter((client) => client.commandes > 0 && client.derniereCommande !== null)
  if (acheteurs.length < ACHETEURS_MIN_RFM) return null
  const recences = acheteurs.map((client) => jours(client.derniereCommande!, maintenant)).sort((a, b) => a - b)
  const montants = acheteurs.map((client) => client.caCents).sort((a, b) => a - b)
  const seuils = (tries: number[]) => [0.2, 0.4, 0.6, 0.8].map((q) => quantile(tries, q))
  const seuilsRecence = seuils(recences)
  const seuilsMontant = seuils(montants)
  const caTotal = montants.reduce((total, valeur) => total + valeur, 0)
  const lignes = new Map<ClasseRfm, { nombre: number; caCents: number }>()
  for (const client of acheteurs) {
    const classe = classeRfm(scoresRfm(client, seuilsRecence, seuilsMontant, maintenant))
    const ligne = lignes.get(classe) ?? { nombre: 0, caCents: 0 }
    ligne.nombre += 1
    ligne.caCents += client.caCents
    lignes.set(classe, ligne)
  }
  return CLASSES_RFM.flatMap((cle) => {
    const ligne = lignes.get(cle)
    return ligne === undefined ? [] : [{ cle, nom: NOM_CLASSE_RFM[cle], ...ligne, partCa: caTotal === 0 ? null : ligne.caCents / caTotal }]
  })
}
