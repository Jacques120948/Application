import type { CommandeExport } from '@/server/integrations/providers/shopify-clients'
import type { CommandeShopify } from '@/server/integrations/providers/shopify'
import { cohortesClients, type CohorteClients } from '@/server/nova/agregat'

/**
 * Ce que les commandes apprennent à Lina, calculé en mémoire et réduit aussitôt.
 *
 * Les commandes elles-mêmes ne sont jamais écrites. Il en reste, par client, trois
 * informations (vraie première commande, rythme habituel, produit principal), et pour la
 * boutique des totaux : par produit, par paire de produits, par cohorte. Pur : aucune base,
 * aucune horloge.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

/** En dessous, une paire de produits ou un intervalle tient du hasard. */
export const PAIRE_MIN = 5
export const INTERVALLES_MIN = 5
const PAIRES_MAX = 30

export type ParClient = {
  ref: string
  /** La première commande, seulement quand toute l'histoire du client est dans l'export. */
  premiereCommande: string | null
  intervalleJours: number | null
  produitPrincipal: string | null
}

export type ProduitAnalyse = {
  ref: string
  titre: string
  type: string
  acheteurs: number
  reacheteurs: number
  commandes: number
  caCents: number
  prixMoyenCents: number
  intervalleMedian: number | null
  intervalleP25: number | null
  intervalleP75: number | null
}

/** « Parmi les acheteurs de A, n ont ensuite acheté B » : part = n ÷ acheteurs de A. */
export type Paire = { de: string; vers: string; clients: number; part: number }

export type Reachat = {
  /** Jours entre la première et la deuxième commande : médiane et quartiles. */
  medianeJours: number | null
  p25Jours: number | null
  p75Jours: number | null
  /** Part des clients qui recommandent dans les 30, 60, 90, 180 jours — seulement ceux arrivés il y a plus de 180 jours. */
  sous: { jours: number; part: number }[]
  base: number
}

export type AnalyseCommandes = {
  au: string
  depuis: string
  commandes: number
  tronque: boolean
  historiqueComplet: boolean
  cohortes: CohorteClients[]
  suivants: Paire[]
  ensemble: Paire[]
  montees: Paire[]
  reachat: Reachat
}

function quantile(tries: readonly number[], q: number): number | null {
  if (tries.length === 0) return null
  const position = (tries.length - 1) * q
  const bas = Math.floor(position)
  const haut = Math.ceil(position)
  return Math.round(tries[bas]! + (tries[haut]! - tries[bas]!) * (position - bas))
}

function jours(de: string, a: string): number {
  return Math.max(0, Math.round((Date.parse(a) - Date.parse(de)) / JOUR_MS))
}

/**
 * @param commandesConnues le nombre de commandes de chaque client selon Shopify, sur toute
 * sa vie : c'est ce qui dit si l'export contient toute son histoire.
 */
export function analyserCommandes(
  commandes: readonly CommandeExport[],
  commandesConnues: ReadonlyMap<string, number>,
  options: { depuis: string; tronque: boolean; historiqueComplet: boolean; fuseau: string; maintenant: Date },
): { parClient: ParClient[]; produits: ProduitAnalyse[]; analyse: AnalyseCommandes } {
  const triees = [...commandes].filter((commande) => commande.creeLe !== '').sort((a, b) => a.creeLe.localeCompare(b.creeLe))
  const parClientCommandes = new Map<string, CommandeExport[]>()
  for (const commande of triees) {
    if (commande.clientRef === null) continue
    const liste = parClientCommandes.get(commande.clientRef) ?? []
    liste.push(commande)
    parClientCommandes.set(commande.clientRef, liste)
  }

  // Par produit : ventes, prix, acheteurs, et intervalles entre deux achats du même client.
  type Cumul = { titre: string; type: string; commandes: number; caCents: number; quantite: number; acheteurs: Set<string>; parClient: Map<string, string[]> }
  const cumuls = new Map<string, Cumul>()
  for (const commande of triees) {
    const vus = new Set<string>()
    for (const ligne of commande.lignes) {
      const cumul = cumuls.get(ligne.produitRef) ?? { titre: ligne.titre, type: ligne.type, commandes: 0, caCents: 0, quantite: 0, acheteurs: new Set(), parClient: new Map() }
      cumul.caCents += ligne.prixUnitaireCents * ligne.quantite
      cumul.quantite += ligne.quantite
      if (!vus.has(ligne.produitRef)) {
        cumul.commandes += 1
        vus.add(ligne.produitRef)
        if (commande.clientRef !== null) {
          cumul.acheteurs.add(commande.clientRef)
          const dates = cumul.parClient.get(commande.clientRef) ?? []
          dates.push(commande.creeLe)
          cumul.parClient.set(commande.clientRef, dates)
        }
      }
      cumuls.set(ligne.produitRef, cumul)
    }
  }
  const produits: ProduitAnalyse[] = [...cumuls.entries()].map(([ref, cumul]) => {
    const intervalles: number[] = []
    let reacheteurs = 0
    for (const dates of cumul.parClient.values()) {
      if (dates.length >= 2) reacheteurs += 1
      for (let i = 1; i < dates.length; i++) intervalles.push(jours(dates[i - 1]!, dates[i]!))
    }
    intervalles.sort((a, b) => a - b)
    const assez = intervalles.length >= INTERVALLES_MIN
    return {
      ref,
      titre: cumul.titre,
      type: cumul.type,
      acheteurs: cumul.acheteurs.size,
      reacheteurs,
      commandes: cumul.commandes,
      caCents: Math.min(cumul.caCents, 2_000_000_000),
      prixMoyenCents: cumul.quantite === 0 ? 0 : Math.round(cumul.caCents / cumul.quantite),
      intervalleMedian: assez ? quantile(intervalles, 0.5) : null,
      intervalleP25: assez ? quantile(intervalles, 0.25) : null,
      intervalleP75: assez ? quantile(intervalles, 0.75) : null,
    }
  })
  const produitDe = new Map(produits.map((produit) => [produit.ref, produit]))

  // Par client : première commande, rythme, produit principal.
  const parClient: ParClient[] = []
  const suivants = new Map<string, Set<string>>()
  const ensemble = new Map<string, Set<string>>()
  const premiersEcarts: number[] = []
  for (const [ref, liste] of parClientCommandes) {
    const complet = options.historiqueComplet || (commandesConnues.get(ref) ?? Number.POSITIVE_INFINITY) <= liste.length
    const ecarts: number[] = []
    for (let i = 1; i < liste.length; i++) ecarts.push(jours(liste[i - 1]!.creeLe, liste[i]!.creeLe))
    ecarts.sort((a, b) => a - b)
    if (complet && liste.length >= 2) premiersEcarts.push(jours(liste[0]!.creeLe, liste[1]!.creeLe))
    const quantites = new Map<string, number>()
    for (const commande of liste) for (const ligne of commande.lignes) quantites.set(ligne.produitRef, (quantites.get(ligne.produitRef) ?? 0) + ligne.quantite)
    const principal = [...quantites.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
    parClient.push({
      ref,
      premiereCommande: complet ? liste[0]!.creeLe : null,
      intervalleJours: ecarts.length === 0 ? null : quantile(ecarts, 0.5),
      produitPrincipal: principal,
    })

    // Paires : ce qui est acheté ensuite (dans une commande plus tardive), et ensemble.
    const dejaAchetes = new Set<string>()
    for (const commande of liste) {
      const ici = [...new Set(commande.lignes.map((ligne) => ligne.produitRef))]
      for (const a of dejaAchetes) {
        for (const b of ici) {
          if (dejaAchetes.has(b) || a === b) continue
          const cle = `${a}>${b}`
          suivants.set(cle, (suivants.get(cle) ?? new Set()).add(ref))
        }
      }
      for (const a of ici) {
        for (const b of ici) {
          if (a >= b) continue
          const cle = `${a}>${b}`
          ensemble.set(cle, (ensemble.get(cle) ?? new Set()).add(ref))
        }
      }
      for (const produit of ici) dejaAchetes.add(produit)
    }
  }

  const enPaires = (source: Map<string, Set<string>>): Paire[] =>
    [...source.entries()]
      .map(([cle, clients]) => {
        const [de, vers] = cle.split('>') as [string, string]
        const base = produitDe.get(de)?.acheteurs ?? 0
        return { de, vers, clients: clients.size, part: base === 0 ? 0 : clients.size / base }
      })
      .filter((paire) => paire.clients >= PAIRE_MIN)
      .sort((a, b) => b.clients - a.clients || b.part - a.part)
  const toutesSuivantes = enPaires(suivants)
  // Montée en gamme : même famille de produit, prix moyen au moins 30 % plus élevé ensuite.
  const montees = toutesSuivantes.filter((paire) => {
    const de = produitDe.get(paire.de)
    const vers = produitDe.get(paire.vers)
    return de !== undefined && vers !== undefined && de.type !== '' && de.type === vers.type && vers.prixMoyenCents >= de.prixMoyenCents * 1.3
  })

  // Réachat : délai entre la première et la deuxième commande, et part de ceux qui reviennent.
  premiersEcarts.sort((a, b) => a - b)
  const limite = +options.maintenant - 180 * JOUR_MS
  const anciens = [...parClientCommandes.entries()].filter(([ref, liste]) => {
    const complet = options.historiqueComplet || (commandesConnues.get(ref) ?? Number.POSITIVE_INFINITY) <= liste.length
    return complet && Date.parse(liste[0]!.creeLe) <= limite
  })
  const sous = [30, 60, 90, 180].map((n) => ({
    jours: n,
    part: anciens.length === 0 ? 0 : anciens.filter(([, liste]) => liste.length >= 2 && jours(liste[0]!.creeLe, liste[1]!.creeLe) <= n).length / anciens.length,
  }))

  // Cohortes : le calcul de Nova, sur les commandes de l'export.
  const pourCohortes: CommandeShopify[] = []
  for (const [ref, liste] of parClientCommandes) {
    const complet = options.historiqueComplet || (commandesConnues.get(ref) ?? Number.POSITIVE_INFINITY) <= liste.length
    liste.forEach((commande, rang) =>
      pourCohortes.push({
        id: commande.id,
        creeLe: commande.creeLe,
        totalCents: commande.totalCents,
        devise: commande.devise,
        annulee: false,
        test: false,
        premiere: complet && rang === 0 ? true : complet ? false : null,
        visite: null,
        premiereVisite: null,
        clientId: ref,
        lignes: [],
      }),
    )
  }
  const aujourdhui = options.maintenant.toISOString().slice(0, 10)
  const cohortes = cohortesClients(pourCohortes, options.fuseau, aujourdhui).slice(-12)

  return {
    parClient,
    produits,
    analyse: {
      au: options.maintenant.toISOString(),
      depuis: options.depuis,
      commandes: triees.length,
      tronque: options.tronque,
      historiqueComplet: options.historiqueComplet,
      cohortes,
      suivants: toutesSuivantes.slice(0, PAIRES_MAX),
      ensemble: enPaires(ensemble).slice(0, PAIRES_MAX),
      montees: montees.slice(0, PAIRES_MAX),
      reachat: {
        medianeJours: premiersEcarts.length >= INTERVALLES_MIN ? quantile(premiersEcarts, 0.5) : null,
        p25Jours: premiersEcarts.length >= INTERVALLES_MIN ? quantile(premiersEcarts, 0.25) : null,
        p75Jours: premiersEcarts.length >= INTERVALLES_MIN ? quantile(premiersEcarts, 0.75) : null,
        sous,
        base: anciens.length,
      },
    },
  }
}
