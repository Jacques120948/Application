import type { CanalNova } from '@/lib/nova'
import type { CommandeShopify } from '@/server/integrations/providers/shopify'
import { jourDansFuseau } from '@/server/ads/metriques'
import { canalDeVisite } from './canaux'

/**
 * Des commandes aux journées : ce qui est conservé.
 *
 * Une commande part d'ici réduite à des totaux. L'identifiant du client, le détail de la
 * visite, les lignes : tout sert au calcul et rien n'est gardé au-delà. Ce qui reste, par
 * jour, c'est un chiffre, un nombre de commandes, un nombre de nouveaux clients, et la
 * répartition par canal et par produit.
 */

export type CanalJour = {
  commandes: number
  chiffreCents: number
  /** Les étiquettes d'origine, telles qu'elles sont arrivées, et combien de commandes chacune. */
  origines: Record<string, number>
}

export type ProduitJour = {
  id: string
  titre: string
  commandes: number
  quantite: number
  chiffreCents: number
  /** Coût d'achat des unités dont le coût est connu, et combien d'unités cela couvre. */
  coutCents: number
  quantiteCoutee: number
}

export type JourVentes = {
  jour: string
  devise: string
  commandes: number
  chiffreCents: number
  nouveauxClients: number
  /** Ce qu'ont rapporté les premières commandes. */
  chiffreNouveauxCents: number
  clientsIdentifies: number
  canaux: Partial<Record<CanalNova, CanalJour>>
  /** Les mêmes commandes, rangées par le canal de leur première visite. */
  canauxPremier: Partial<Record<CanalNova, CanalJour>>
  produits: ProduitJour[]
  /** Les coûts ont-ils été lus pour ce jour ? Sans eux, les trois totaux suivants sont vides, pas nuls. */
  coutsLus: boolean
  /** Ce que rapportent toutes les lignes de produits (hors livraison), et celles dont le coût est connu. */
  lignesCents: number
  lignesCouteesCents: number
  /** Le coût d'achat des lignes dont le coût est connu. */
  coutProduitsCents: number
}

function ranger(
  canaux: Partial<Record<CanalNova, CanalJour>>,
  visite: CommandeShopify['visite'],
  totalCents: number,
): void {
  const { canal, origine } = canalDeVisite(visite)
  const ligne = canaux[canal] ?? { commandes: 0, chiffreCents: 0, origines: {} }
  ligne.commandes += 1
  ligne.chiffreCents += totalCents
  ligne.origines[origine] = (ligne.origines[origine] ?? 0) + 1
  canaux[canal] = ligne
}

/**
 * Les clients d'une fenêtre, comptés : combien de personnes distinctes, combien sont
 * revenues, ce qu'elles ont rapporté.
 *
 * C'est le seul calcul qui a besoin de reconnaître un client d'une commande à l'autre, et il
 * se fait ici, en mémoire, pendant la synchronisation. Ce qui en sort est un compte ; les
 * identifiants ne quittent pas cette fonction.
 */
export type InstantaneClients = {
  /** Le jour du calcul, et la fenêtre couverte. */
  au: string
  depuis: string
  clients: number
  /** Clients qui ont commandé au moins deux fois dans la fenêtre. */
  recurrents: number
  commandes: number
  chiffreCents: number
}

export function instantaneClients(
  commandes: readonly CommandeShopify[],
  depuis: string,
  au: string,
): InstantaneClients | null {
  const retenues = commandes.filter((commande) => !commande.test && !commande.annulee && commande.clientId !== null)
  if (retenues.length === 0) return null
  const parClient = new Map<string, number>()
  let chiffreCents = 0
  for (const commande of retenues) {
    parClient.set(commande.clientId!, (parClient.get(commande.clientId!) ?? 0) + 1)
    chiffreCents += commande.totalCents
  }
  return {
    au,
    depuis,
    clients: parClient.size,
    recurrents: [...parClient.values()].filter((n) => n >= 2).length,
    commandes: retenues.length,
    chiffreCents,
  }
}

/** Les produits gardés par jour : au-delà, la ligne pèse sans rien apprendre de plus. */
const PRODUITS_PAR_JOUR = 50

/**
 * Les commandes d'une période, rangées par jour dans le fuseau de la boutique.
 *
 * Écartées : les commandes de test et les commandes annulées. Une commande remboursée en
 * partie reste, pour ce qu'elle a réellement rapporté.
 *
 * `couts` : le coût unitaire de chaque variante, en centimes, quand Shopify l'a donné.
 * Absent, les jours sont marqués « coûts non lus » — une marge ne se calculera pas dessus.
 */
export function agregerCommandes(
  commandes: readonly CommandeShopify[],
  fuseau: string,
  couts: ReadonlyMap<string, number> | null = null,
): JourVentes[] {
  const jours = new Map<string, JourVentes>()
  const produits = new Map<string, Map<string, ProduitJour>>()

  for (const commande of commandes) {
    if (commande.test || commande.annulee) continue
    const date = new Date(commande.creeLe)
    if (Number.isNaN(+date)) continue
    const jour = jourDansFuseau(date, fuseau)

    const courant =
      jours.get(jour) ??
      ({
        jour,
        devise: commande.devise,
        commandes: 0,
        chiffreCents: 0,
        nouveauxClients: 0,
        chiffreNouveauxCents: 0,
        clientsIdentifies: 0,
        canaux: {},
        canauxPremier: {},
        produits: [],
        coutsLus: couts !== null,
        lignesCents: 0,
        lignesCouteesCents: 0,
        coutProduitsCents: 0,
      } satisfies JourVentes)
    courant.commandes += 1
    courant.chiffreCents += commande.totalCents
    if (commande.premiere !== null) courant.clientsIdentifies += 1
    if (commande.premiere === true) {
      courant.nouveauxClients += 1
      courant.chiffreNouveauxCents += commande.totalCents
    }

    ranger(courant.canaux, commande.visite, commande.totalCents)
    // Sans première visite connue, on ne la déduit pas de la dernière : ce serait inventer un parcours.
    ranger(courant.canauxPremier, commande.premiereVisite, commande.totalCents)
    jours.set(jour, courant)

    const duJour = produits.get(jour) ?? new Map<string, ProduitJour>()
    const vus = new Set<string>()
    for (const article of commande.lignes) {
      if (article.quantite <= 0) continue
      const cle = article.produitId ?? `titre:${article.titre}`
      const produit =
        duJour.get(cle) ?? { id: cle, titre: article.titre, commandes: 0, quantite: 0, chiffreCents: 0, coutCents: 0, quantiteCoutee: 0 }
      produit.quantite += article.quantite
      produit.chiffreCents += article.totalCents
      const unitaire = couts === null || article.varianteId === null ? undefined : couts.get(article.varianteId)
      courant.lignesCents += article.totalCents
      if (unitaire !== undefined) {
        produit.coutCents += unitaire * article.quantite
        produit.quantiteCoutee += article.quantite
        courant.lignesCouteesCents += article.totalCents
        courant.coutProduitsCents += unitaire * article.quantite
      }
      // Une commande compte une fois par produit, même si le produit y figure sur deux lignes.
      if (!vus.has(cle)) produit.commandes += 1
      vus.add(cle)
      duJour.set(cle, produit)
    }
    produits.set(jour, duJour)
  }

  return [...jours.values()]
    .map((jour) => ({
      ...jour,
      produits: [...(produits.get(jour.jour)?.values() ?? [])]
        .sort((un, autre) => autre.chiffreCents - un.chiffreCents)
        .slice(0, PRODUITS_PAR_JOUR),
    }))
    .sort((un, autre) => un.jour.localeCompare(autre.jour))
}

/**
 * Les cohortes de clients : ceux dont la première commande tombe dans un même mois, suivis
 * ensuite mois par mois.
 *
 * Comme le compte des clients, c'est un calcul qui a besoin de reconnaître un client d'une
 * commande à l'autre ; il se fait ici, en mémoire, pendant la synchronisation, et seules des
 * proportions et des moyennes en sortent. Une première commande est celle que Shopify dit
 * première (rang 1 dans l'historique du client) — pas la première que la fenêtre a vue.
 */
export type CohorteClients = {
  /** AAAA-MM de la première commande. */
  mois: string
  clients: number
  /** Part des clients qui ont recommandé, cumulée, à la fin de chaque mois (0 = le mois de départ). */
  revenus: number[]
  /** Chiffre d'affaires cumulé par client à la fin de chaque mois, en centimes. */
  chiffreParClientCents: number[]
}

/** En deçà, une cohorte est une anecdote. */
export const COHORTE_CLIENTS_MIN = 5

function decalerMois(mois: string, n: number): string {
  const [annee, m] = mois.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(annee, m - 1 + n, 1)).toISOString().slice(0, 7)
}

export function cohortesClients(commandes: readonly CommandeShopify[], fuseau: string, aujourdhui: string): CohorteClients[] {
  const retenues = commandes.filter((commande) => !commande.test && !commande.annulee && commande.clientId !== null && commande.creeLe !== '')
  const parClient = new Map<string, { mois: string; montant: number }[]>()
  const departs = new Map<string, string>()
  for (const commande of retenues) {
    const mois = jourDansFuseau(new Date(commande.creeLe), fuseau).slice(0, 7)
    const liste = parClient.get(commande.clientId!) ?? []
    liste.push({ mois, montant: commande.totalCents })
    parClient.set(commande.clientId!, liste)
    if (commande.premiere === true) departs.set(commande.clientId!, mois)
  }
  const moisCourant = aujourdhui.slice(0, 7)
  const parCohorte = new Map<string, string[]>()
  for (const [client, mois] of departs) parCohorte.set(mois, [...(parCohorte.get(mois) ?? []), client])

  const cohortes: CohorteClients[] = []
  for (const [mois, clients] of [...parCohorte.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (clients.length < COHORTE_CLIENTS_MIN) continue
    const revenus: number[] = []
    const chiffre: number[] = []
    for (let k = 0; decalerMois(mois, k) <= moisCourant; k++) {
      const limite = decalerMois(mois, k)
      let revenusK = 0
      let chiffreK = 0
      for (const client of clients) {
        const jusque = (parClient.get(client) ?? []).filter((commande) => commande.mois <= limite)
        if (jusque.length >= 2) revenusK += 1
        chiffreK += jusque.reduce((total, commande) => total + commande.montant, 0)
      }
      revenus.push(revenusK / clients.length)
      chiffre.push(Math.round(chiffreK / clients.length))
    }
    cohortes.push({ mois, clients: clients.length, revenus, chiffreParClientCents: chiffre })
  }
  return cohortes
}
