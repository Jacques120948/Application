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
 */
export function agregerCommandes(commandes: readonly CommandeShopify[], fuseau: string): JourVentes[] {
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
      const produit = duJour.get(cle) ?? { id: cle, titre: article.titre, commandes: 0, quantite: 0, chiffreCents: 0 }
      produit.quantite += article.quantite
      produit.chiffreCents += article.totalCents
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
