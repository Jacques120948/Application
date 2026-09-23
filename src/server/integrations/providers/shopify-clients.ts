import { appeler, type AccesShopify, type Reponse } from './shopify'

/**
 * La base clients Shopify, pour Lina.
 *
 * **Un export en masse, pas une pagination.** Lire des milliers de clients page par page
 * épuise le débit que Shopify accorde et ne tient pas dans une requête : une boutique de
 * quatre mille clients demanderait plusieurs minutes. L'export en masse (« bulk operation »)
 * est fait pour cela : on le lance, Shopify le prépare de son côté, et on relit un fichier
 * quand il est prêt. Il ne coûte rien, ni à Evoliia ni à la boutique.
 *
 * **Ce qui est lu d'un client, et rien d'autre** : sa date de création, son nombre de
 * commandes, son montant cumulé, la date de sa dernière commande, et s'il accepte les
 * courriels marketing. Ni nom, ni courriel, ni téléphone, ni adresse ne sont demandés : ils
 * ne traversent donc jamais le réseau. Le consentement vient d'un champ que Shopify range
 * près du courriel ; si Shopify le refuse, on relance sans lui, et il est « inconnu ».
 *
 * Les paniers abandonnés sont lus à part, en quelques pages, et réduits aussitôt à des totaux.
 */

/** Au-delà, l'index est tronqué et l'écran le dit. De quoi couvrir une très grosse boutique. */
export const CLIENTS_MAX = 50_000

/** Paniers abandonnés lus au plus : trente jours d'une boutique très active. */
export const PANIERS_MAX = 2_000
const PANIERS_PAR_PAGE = 100

export type ConsentementClient = 'oui' | 'non' | 'sans-email' | 'inconnu'

export type ClientShopify = {
  /** L'identifiant numérique du client dans Shopify : de quoi ouvrir sa fiche, rien d'autre. */
  ref: string
  creeLe: string
  derniereCommande: string | null
  commandes: number
  caCents: number
  devise: string
  consentement: ConsentementClient
}

export type StatutExport = 'en-cours' | 'termine' | 'refuse' | 'echec'

function requeteExport(consentement: boolean): string {
  return `{
  customers {
    edges {
      node {
        id
        createdAt
        numberOfOrders
        amountSpent { amount currencyCode }
        lastOrder { createdAt }
        ${consentement ? 'defaultEmailAddress { marketingState }' : ''}
      }
    }
  }
}`
}

const LANCER = `mutation($q: String!) {
  bulkOperationRunQuery(query: $q) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`

const SUIVRE = `query($id: ID!) {
  bulkOperation(id: $id) { id status errorCode objectCount url partialDataUrl }
}`

/** Shopify range les clients parmi les « données protégées » : le refus a sa formule. */
export function refusDonneesProtegees(erreurs: readonly string[]): boolean {
  return erreurs.some((erreur) => /not approved to access|protected customer data|access denied|ACCESS_DENIED/iu.test(erreur))
}

function erreursUtilisateur(reponse: Reponse): string[] {
  const resultat = (reponse.data?.bulkOperationRunQuery ?? null) as { userErrors?: { message?: string }[] } | null
  return (resultat?.userErrors ?? []).map((erreur) => erreur.message ?? '').filter((message) => message !== '')
}

/** Lance l'export des clients. Rend l'identifiant de l'opération, à relire plus tard. */
export async function lancerExportClients(
  acces: AccesShopify,
  jeton: string,
  consentement: boolean,
): Promise<{ ok: true; operation: string } | { ok: false; raison: string; protegees: boolean }> {
  const reponse = await appeler(acces.boutique, jeton, acces.version, LANCER, { q: requeteExport(consentement) })
  const refus = [...reponse.erreurs, ...erreursUtilisateur(reponse)]
  const operation = (reponse.data?.bulkOperationRunQuery as { bulkOperation?: { id?: string } | null } | undefined)?.bulkOperation?.id
  if (reponse.status === 200 && typeof operation === 'string') return { ok: true, operation }
  const protegees = refusDonneesProtegees(refus)
  return {
    ok: false,
    protegees,
    raison: protegees
      ? 'Shopify demande de déclarer l’accès aux données client protégées avant de laisser lire vos clients.'
      : /read_customers|customers field|access scope/iu.test(refus.join(' '))
        ? 'L’autorisation « read_customers » manque à votre application Shopify.'
        : /already in progress|en cours/iu.test(refus.join(' '))
          ? 'Un export est déjà en cours chez Shopify. Lina réessaiera dans quelques minutes.'
          : `Shopify a refusé l’export des clients (${reponse.status}).`,
  }
}

/** Où en est l'export. `url` n'est rendu que terminé : le fichier expire après sept jours. */
export async function suivreExport(
  acces: AccesShopify,
  jeton: string,
  operation: string,
): Promise<{ statut: StatutExport; url: string | null; lus: number; raison: string }> {
  const reponse = await appeler(acces.boutique, jeton, acces.version, SUIVRE, { id: operation })
  const op = (reponse.data?.bulkOperation ?? null) as {
    status?: string
    errorCode?: string | null
    objectCount?: string | number
    url?: string | null
    partialDataUrl?: string | null
  } | null
  if (reponse.status !== 200 || op === null) {
    return { statut: 'echec', url: null, lus: 0, raison: `Shopify n’a pas rendu l’état de l’export (${reponse.status}).` }
  }
  const lus = Number(op.objectCount ?? 0) || 0
  if (op.status === 'COMPLETED') return { statut: 'termine', url: op.url ?? null, lus, raison: '' }
  if (op.status === 'CREATED' || op.status === 'RUNNING' || op.status === 'CANCELING') return { statut: 'en-cours', url: null, lus, raison: '' }
  if (op.errorCode === 'ACCESS_DENIED') {
    return { statut: 'refuse', url: null, lus, raison: 'Shopify refuse l’accès aux données client protégées.' }
  }
  return { statut: 'echec', url: null, lus, raison: `L’export Shopify a échoué (${op.errorCode ?? op.status ?? 'inconnu'}).` }
}

function centimes(montant: unknown): number {
  const valeur = typeof montant === 'string' ? Number(montant) : typeof montant === 'number' ? montant : NaN
  return Number.isFinite(valeur) ? Math.round(valeur * 100) : 0
}

function consentementDe(brut: { marketingState?: string | null } | null | undefined, lu: boolean): ConsentementClient {
  if (!lu) return 'inconnu'
  if (brut == null) return 'sans-email'
  return brut.marketingState === 'SUBSCRIBED' ? 'oui' : 'non'
}

/**
 * Une ligne du fichier d'export, convertie. `null` pour ce qui n'est pas un client : le
 * fichier peut porter d'autres objets si la requête en demandait.
 */
export function lireLigneClient(ligne: string, consentementLu: boolean): ClientShopify | null {
  let brut: {
    id?: string
    createdAt?: string
    numberOfOrders?: string | number
    amountSpent?: { amount?: string; currencyCode?: string } | null
    lastOrder?: { createdAt?: string } | null
    defaultEmailAddress?: { marketingState?: string | null } | null
  }
  try {
    brut = JSON.parse(ligne)
  } catch {
    return null
  }
  if (typeof brut.id !== 'string' || !brut.id.startsWith('gid://shopify/Customer/')) return null
  if (typeof brut.createdAt !== 'string') return null
  const commandes = Number(brut.numberOfOrders ?? 0)
  return {
    ref: brut.id.slice('gid://shopify/Customer/'.length),
    creeLe: brut.createdAt,
    derniereCommande: brut.lastOrder?.createdAt ?? null,
    commandes: Number.isFinite(commandes) ? commandes : 0,
    caCents: centimes(brut.amountSpent?.amount),
    devise: brut.amountSpent?.currencyCode ?? '',
    consentement: consentementDe(brut.defaultEmailAddress, consentementLu),
  }
}

/**
 * Relit le fichier préparé par Shopify. Il est servi par le stockage de Shopify, par une
 * adresse signée et temporaire : on ne suit aucune redirection vers ailleurs.
 */
export async function telechargerExport(
  url: string,
  consentementLu: boolean,
  max = CLIENTS_MAX,
): Promise<{ clients: ClientShopify[]; tronque: boolean }> {
  if (!/^https:\/\//u.test(url)) throw new Error('Adresse d’export inattendue.')
  const reponse = await fetch(url, { signal: AbortSignal.timeout(45_000) })
  if (!reponse.ok) throw new Error(`Le fichier d’export n’a pas pu être relu (${reponse.status}).`)
  const texte = await reponse.text()
  const clients: ClientShopify[] = []
  let tronque = false
  for (const ligne of texte.split('\n')) {
    if (ligne.trim() === '') continue
    const client = lireLigneClient(ligne, consentementLu)
    if (client === null) continue
    if (clients.length >= max) {
      tronque = true
      break
    }
    clients.push(client)
  }
  return { clients, tronque }
}

export type PanierShopify = { creeLe: string; recupere: boolean; totalCents: number; devise: string }

const PANIERS = `query($n: Int!, $apres: String, $q: String!) {
  abandonedCheckouts(first: $n, after: $apres, query: $q, sortKey: CREATED_AT) {
    nodes { createdAt completedAt totalPriceSet { shopMoney { amount currencyCode } } }
    pageInfo { hasNextPage endCursor }
  }
}`

/**
 * Les paniers abandonnés depuis une date : quand, combien, et s'ils ont été finalement
 * payés. Ni le client, ni son courriel, ni le lien de reprise ne sont demandés.
 */
export async function lirePaniersAbandonnes(
  acces: AccesShopify,
  jeton: string,
  depuis: string,
  max = PANIERS_MAX,
): Promise<{ ok: true; paniers: PanierShopify[]; tronque: boolean } | { ok: false; raison: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(depuis)) throw new Error('Date de début illisible.')
  const paniers: PanierShopify[] = []
  let apres: string | null = null
  while (paniers.length < max) {
    const reponse: Reponse = await appeler(acces.boutique, jeton, acces.version, PANIERS, {
      n: Math.min(PANIERS_PAR_PAGE, max - paniers.length),
      apres,
      q: `created_at:>=${depuis}`,
    })
    const page = (reponse.data?.abandonedCheckouts ?? null) as {
      nodes: { createdAt: string; completedAt: string | null; totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } } }[]
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
    } | null
    if (reponse.status !== 200 || page === null) {
      return {
        ok: false,
        raison: refusDonneesProtegees(reponse.erreurs)
          ? 'Shopify demande l’accès aux données client protégées pour lire les paniers abandonnés.'
          : `Shopify n’a pas rendu les paniers abandonnés (${reponse.status}).`,
      }
    }
    for (const noeud of page.nodes) {
      paniers.push({
        creeLe: noeud.createdAt,
        recupere: noeud.completedAt !== null,
        totalCents: centimes(noeud.totalPriceSet?.shopMoney?.amount),
        devise: noeud.totalPriceSet?.shopMoney?.currencyCode ?? '',
      })
    }
    if (page.pageInfo?.hasNextPage !== true || (page.pageInfo.endCursor ?? null) === null) return { ok: true, paniers, tronque: false }
    apres = page.pageInfo.endCursor ?? null
  }
  return { ok: true, paniers, tronque: true }
}
