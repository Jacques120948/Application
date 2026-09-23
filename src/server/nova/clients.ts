import { CANAUX, NOM_CANAL, type CanalNova } from '@/lib/nova'
import type { InstantaneClients } from './agregat'
import type { CanalVentes, CumulVentes } from './metriques'

/**
 * Les clients et leur parcours : ce qui se compte, et ce qui s'interprète.
 *
 * Deux régimes, et l'écran les sépare. Les comptes — nouveaux clients, clients revenus,
 * valeur sur quatre-vingt-dix jours — sont des faits. La lecture du parcours — « Meta
 * semble intervenir en début de parcours » — est une interprétation, et elle le dit.
 */

function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100
}

// ── Nouveaux et existants ────────────────────────────────────────────────────

export type RepartitionClients = {
  nouveaux: { commandes: number; chiffre: number }
  /** Commandes de clients déjà venus. Leur chiffre n'est pas isolé : il est dans « autres ». */
  existants: { commandes: number }
  /** Commandes sans client identifié : on ne sait pas s'ils sont nouveaux. */
  inconnus: { commandes: number }
  /** Le chiffre des commandes qui ne sont pas des premières commandes connues. */
  autresChiffre: number
  /** Part des commandes faites par de nouveaux clients, parmi celles dont on sait. */
  partNouveaux: number | null
}

export function repartitionClients(ventes: CumulVentes | null): RepartitionClients | null {
  if (ventes === null || ventes.commandes === 0) return null
  const existants = Math.max(0, ventes.clientsIdentifies - ventes.nouveauxClients)
  return {
    nouveaux: { commandes: ventes.nouveauxClients, chiffre: arrondi(ventes.chiffreNouveaux) },
    existants: { commandes: existants },
    inconnus: { commandes: Math.max(0, ventes.commandes - ventes.clientsIdentifies) },
    autresChiffre: arrondi(ventes.chiffre - ventes.chiffreNouveaux),
    partNouveaux: ventes.clientsIdentifies === 0 ? null : ventes.nouveauxClients / ventes.clientsIdentifies,
  }
}

// ── Valeur client ────────────────────────────────────────────────────────────

/** En deçà, une valeur moyenne par client dépend de deux ou trois personnes. */
export const CLIENTS_MIN = 20

export type ValeurClient =
  | {
      etat: 'calculee'
      depuis: string
      au: string
      clients: number
      recurrents: number
      /** Part des clients revenus au moins une fois dans la fenêtre, de 0 à 1. */
      tauxRetour: number
      commandesParClient: number
      /** Ce qu'un client a rapporté en moyenne sur la fenêtre — pas sur toute sa vie. */
      valeur: number
    }
  | { etat: 'insuffisant'; raison: string }

export const MENTION_VALEUR =
  'Valeur moyenne d’un client sur la fenêtre lue (90 jours au plus), pas sur toute sa vie : une vraie LTV demande plusieurs mois d’historique.'

export function valeurClient(instantane: InstantaneClients | null): ValeurClient {
  if (instantane === null) {
    return {
      etat: 'insuffisant',
      raison: 'Le compte des clients se fait à la lecture complète des ventes, quand Shopify rend les clients.',
    }
  }
  if (instantane.clients < CLIENTS_MIN) {
    return { etat: 'insuffisant', raison: `Moins de ${CLIENTS_MIN} clients sur la fenêtre : une moyenne n’aurait pas de sens.` }
  }
  return {
    etat: 'calculee',
    depuis: instantane.depuis,
    au: instantane.au,
    clients: instantane.clients,
    recurrents: instantane.recurrents,
    tauxRetour: instantane.recurrents / instantane.clients,
    commandesParClient: arrondi(instantane.commandes / instantane.clients),
    valeur: arrondi(instantane.chiffreCents / 100 / instantane.clients),
  }
}

// ── Modèles d'attribution ────────────────────────────────────────────────────

export type Modele = 'dernier' | 'premier' | 'partage'

export const MODELES: Record<Modele, { nom: string; explication: string }> = {
  dernier: { nom: 'Dernier clic', explication: 'Toute la vente au canal de la dernière visite avant l’achat.' },
  premier: { nom: 'Premier clic', explication: 'Toute la vente au canal qui a fait connaître la boutique.' },
  partage: { nom: 'Partagé premier / dernier', explication: 'La moitié au premier contact, la moitié au dernier.' },
}

export type LigneModele = { canal: CanalNova; nom: string; commandes: Record<Modele, number>; chiffre: Record<Modele, number> }

/**
 * Le chiffre de chaque canal selon trois règles de partage.
 *
 * Le partage « premier / dernier » est exact, pas approché : chaque commande donne une
 * moitié au canal de sa première visite et une moitié à celui de sa dernière, si bien que le
 * total d'un canal vaut la moyenne de ses deux colonnes. Les modèles linéaire, en position
 * et « data-driven » demandent toutes les visites intermédiaires : ils attendent Google
 * Analytics 4.
 *
 * `null` tant qu'aucune première visite n'est connue — les jours lus avant la V2 n'en
 * portent pas, et un premier clic « non attribué » partout n'apprendrait rien.
 */
export function modelesAttribution(ventes: CumulVentes | null): LigneModele[] | null {
  if (ventes === null) return null
  const premierConnu = Object.entries(ventes.canauxPremier).some(([canal, ligne]) => canal !== 'inconnu' && (ligne?.commandes ?? 0) > 0)
  if (!premierConnu) return null
  const lire = (canaux: Partial<Record<CanalNova, CanalVentes>>, canal: CanalNova) => canaux[canal] ?? { commandes: 0, chiffre: 0 }
  return CANAUX.map((canal) => {
    const dernier = lire(ventes.canaux, canal)
    const premier = lire(ventes.canauxPremier, canal)
    return {
      canal,
      nom: NOM_CANAL[canal],
      commandes: {
        dernier: dernier.commandes,
        premier: premier.commandes,
        partage: arrondi((dernier.commandes + premier.commandes) / 2),
      },
      chiffre: {
        dernier: arrondi(dernier.chiffre),
        premier: arrondi(premier.chiffre),
        partage: arrondi((dernier.chiffre + premier.chiffre) / 2),
      },
    }
  }).filter((ligne) => ligne.commandes.dernier > 0 || ligne.commandes.premier > 0)
}

/** En deçà, un rôle dans le parcours ne se lit pas. */
const COMMANDES_PARCOURS_MIN = 5

/**
 * Où chaque canal intervient dans le parcours : une interprétation, et écrite comme telle.
 *
 * Un canal qui fait connaître la boutique bien plus souvent qu'il ne conclut la vente
 * « semble intervenir en début de parcours » ; l'inverse, « plus près de l'achat ». Rien de
 * plus : on ne sait pas ce qui s'est passé entre les deux visites.
 */
export function lectureParcours(lignes: LigneModele[] | null): string[] {
  if (lignes === null) return []
  const phrases: string[] = []
  for (const ligne of lignes) {
    if (ligne.canal === 'inconnu' || ligne.canal === 'direct') continue
    const { premier, dernier } = ligne.commandes
    if (premier + dernier < COMMANDES_PARCOURS_MIN * 2) continue
    if (premier >= dernier * 1.5 && premier >= COMMANDES_PARCOURS_MIN) {
      phrases.push(`${ligne.nom} semble surtout intervenir en début de parcours : premier contact de ${premier} commandes, dernier de ${dernier}.`)
    } else if (dernier >= premier * 1.5 && dernier >= COMMANDES_PARCOURS_MIN) {
      phrases.push(`${ligne.nom} semble intervenir plus près de l’achat : dernier contact de ${dernier} commandes, premier de ${premier}.`)
    }
  }
  return phrases
}

export const MENTION_PARCOURS =
  'Interprétation à partir de la première et de la dernière visite enregistrées par Shopify. Les visites intermédiaires ne sont pas connues.'
