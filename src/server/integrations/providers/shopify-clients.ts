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
 * Les lignes d'un fichier d'export, lues en flux : un export de commandes pèse plusieurs
 * dizaines de mégaoctets, et le lire d'un bloc doublerait la mémoire pour rien. Le fichier
 * est servi par le stockage de Shopify, par une adresse signée et temporaire.
 */
export async function* lignesExport(url: string): AsyncGenerator<string> {
  if (!/^https:\/\//u.test(url)) throw new Error('Adresse d’export inattendue.')
  const reponse = await fetch(url, { signal: AbortSignal.timeout(50_000) })
  if (!reponse.ok || reponse.body === null) throw new Error(`Le fichier d’export n’a pas pu être relu (${reponse.status}).`)
  const lecteur = reponse.body.getReader()
  const decodeur = new TextDecoder()
  let reste = ''
  for (;;) {
    const { value, done } = await lecteur.read()
    if (done) break
    reste += decodeur.decode(value, { stream: true })
    let fin = reste.indexOf('\n')
    while (fin >= 0) {
      const ligne = reste.slice(0, fin)
      reste = reste.slice(fin + 1)
      if (ligne.trim() !== '') yield ligne
      fin = reste.indexOf('\n')
    }
  }
  reste += decodeur.decode()
  if (reste.trim() !== '') yield reste
}

/** Relit l'export des clients. */
export async function telechargerExport(
  url: string,
  consentementLu: boolean,
  max = CLIENTS_MAX,
): Promise<{ clients: ClientShopify[]; tronque: boolean }> {
  const clients: ClientShopify[] = []
  let tronque = false
  for await (const ligne of lignesExport(url)) {
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

// ── V2 : les commandes ──────────────────────────────────────────────────────

/** Au-delà, l'analyse des produits porte sur les commandes les plus anciennes lues, et le dit. */
export const COMMANDES_EXPORT_MAX = 150_000

/**
 * Une commande de l'export, réduite à ce qui sert : quand, qui (un identifiant, rien
 * d'autre), combien, et quels produits. Ni adresse, ni nom, ni note.
 */
export type CommandeExport = {
  id: string
  creeLe: string
  clientRef: string | null
  totalCents: number
  devise: string
  lignes: { produitRef: string; titre: string; type: string; quantite: number; prixUnitaireCents: number }[]
}

function requeteCommandes(depuis: string): string {
  return `{
  orders(query: "created_at:>=${depuis} AND status:any") {
    edges {
      node {
        id
        createdAt
        cancelledAt
        test
        customer { id }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        lineItems {
          edges {
            node {
              quantity
              originalUnitPriceSet { shopMoney { amount } }
              product { id title productType }
            }
          }
        }
      }
    }
  }
}`
}

/** Lance l'export des commandes depuis une date (AAAA-MM-JJ calculée par le serveur). */
export async function lancerExportCommandes(
  acces: AccesShopify,
  jeton: string,
  depuis: string,
): Promise<{ ok: true; operation: string } | { ok: false; raison: string; protegees: boolean }> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(depuis)) throw new Error('Date de début illisible.')
  const reponse = await appeler(acces.boutique, jeton, acces.version, LANCER, { q: requeteCommandes(depuis) })
  const refus = [...reponse.erreurs, ...erreursUtilisateur(reponse)]
  const operation = (reponse.data?.bulkOperationRunQuery as { bulkOperation?: { id?: string } | null } | undefined)?.bulkOperation?.id
  if (reponse.status === 200 && typeof operation === 'string') return { ok: true, operation }
  const protegees = refusDonneesProtegees(refus)
  return {
    ok: false,
    protegees,
    raison: protegees
      ? 'Shopify demande l’accès aux données client protégées pour relier les commandes aux clients.'
      : `Shopify a refusé l’export des commandes (${reponse.status}).`,
  }
}

/** Relit l'export des commandes : une ligne par commande, puis une ligne par article. */
export async function telechargerCommandes(url: string, max = COMMANDES_EXPORT_MAX): Promise<{ commandes: CommandeExport[]; tronque: boolean }> {
  const parId = new Map<string, CommandeExport>()
  const annulees = new Set<string>()
  let tronque = false
  for await (const ligne of lignesExport(url)) {
    let brut: Record<string, unknown>
    try {
      brut = JSON.parse(ligne) as Record<string, unknown>
    } catch {
      continue
    }
    const id = typeof brut.id === 'string' ? brut.id : ''
    if (id.startsWith('gid://shopify/Order/')) {
      if (brut.cancelledAt != null || brut.test === true) {
        annulees.add(id)
        continue
      }
      if (parId.size >= max) {
        tronque = true
        continue
      }
      const client = (brut.customer as { id?: string } | null)?.id ?? null
      const total = (brut.currentTotalPriceSet as { shopMoney?: { amount?: string; currencyCode?: string } } | undefined)?.shopMoney
      parId.set(id, {
        id,
        creeLe: String(brut.createdAt ?? ''),
        clientRef: client === null ? null : client.slice(client.lastIndexOf('/') + 1),
        totalCents: centimes(total?.amount),
        devise: total?.currencyCode ?? '',
        lignes: [],
      })
      continue
    }
    const parent = typeof brut.__parentId === 'string' ? brut.__parentId : ''
    const commande = parId.get(parent)
    const produit = brut.product as { id?: string; title?: string; productType?: string } | null | undefined
    if (commande === undefined || produit?.id == null) continue
    commande.lignes.push({
      produitRef: produit.id.slice(produit.id.lastIndexOf('/') + 1),
      titre: produit.title ?? '',
      type: produit.productType ?? '',
      quantite: Number(brut.quantity ?? 0) || 0,
      prixUnitaireCents: centimes((brut.originalUnitPriceSet as { shopMoney?: { amount?: string } } | undefined)?.shopMoney?.amount),
    })
  }
  return { commandes: [...parId.values()], tronque }
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

// ── V4 : le mode assisté ────────────────────────────────────────────────────

const CREER_SEGMENT = `mutation($nom: String!, $q: String!) {
  segmentCreate(name: $nom, query: $q) {
    segment { id name }
    userErrors { field message }
  }
}`

/**
 * Crée un segment de clients dans Shopify — la seule écriture de Lina, et seulement sur la
 * validation de la personne. Un segment est une requête enregistrée : aucune fiche client
 * n'est modifiée, aucun message n'est envoyé. Shopify exige pour cela « write_customers ».
 */
export async function creerSegmentShopify(
  acces: AccesShopify,
  jeton: string,
  nom: string,
  requete: string,
): Promise<{ ok: true; id: string } | { ok: false; raison: string; portee: boolean }> {
  const reponse = await appeler(acces.boutique, jeton, acces.version, CREER_SEGMENT, { nom, q: requete })
  const resultat = (reponse.data?.segmentCreate ?? null) as { segment?: { id?: string } | null; userErrors?: { message?: string }[] } | null
  const id = resultat?.segment?.id
  if (reponse.status === 200 && typeof id === 'string') return { ok: true, id }
  const refus = [...reponse.erreurs, ...(resultat?.userErrors ?? []).map((erreur) => erreur.message ?? '')].filter((un) => un !== '')
  const portee = /write_customers|access denied|ACCESS_DENIED/iu.test(refus.join(' '))
  return {
    ok: false,
    portee,
    raison: portee
      ? 'Shopify demande l’autorisation « write_customers » pour créer un segment. Ajoutez-la à votre application (Dev Dashboard, onglet « Versions »), publiez, puis réessayez. Lina ne s’en sert que pour créer des segments.'
      : /name.*taken|already exists|déjà/iu.test(refus.join(' '))
        ? 'Un segment porte déjà ce nom dans Shopify.'
        : `Shopify a refusé le segment${refus[0] === undefined ? ` (${reponse.status})` : ` : ${refus[0].slice(0, 200)}`}.`,
  }
}
