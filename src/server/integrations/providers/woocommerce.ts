import { parseTargetUrl, requeteJson, type ReponseJson } from '@/server/audit/net'
import type { CommandeShopify, VisiteShopify } from './shopify'
import type { KeyVerdict } from '../verify'

/**
 * WooCommerce, en lecture seule, par les clés d'API REST de la boutique.
 *
 * La personne crée une clé dans WooCommerce → Réglages → Avancé → API REST, avec la
 * permission « Lecture », et colle l'adresse, la clé et le secret. Evoliia ne demande aucun
 * mot de passe WordPress : une clé se révoque d'un clic, un mot de passe ouvre tout.
 *
 * La boutique est sur un serveur que la personne choisit : chaque appel passe par la requête
 * protégée de audit/net.ts (adresse publique vérifiée après résolution, https, pas de
 * redirection suivie). Ce que Nova en garde est la même chose que pour Shopify : des totaux
 * par jour, jamais un client.
 */

export type AccesWoo = { boutique: string; cle: string; secret: string }

export const COMMANDES_WOO_MAX = 1_500
const PAR_PAGE = 100

/** L'adresse de la boutique, ramenée à son origine et à son chemin WordPress éventuel. */
export function normaliserBoutiqueWoo(brut: string): string {
  const url = parseTargetUrl(/^https?:\/\//iu.test(brut.trim()) ? brut.trim() : `https://${brut.trim()}`)
  url.protocol = 'https:'
  url.search = ''
  const chemin = url.pathname.replace(/\/wp-json.*$/iu, '').replace(/\/+$/u, '')
  return `${url.origin}${chemin}`
}

export function lireAccesWoo(secret: string): AccesWoo | null {
  try {
    const brut = JSON.parse(secret) as Partial<AccesWoo>
    if (typeof brut.boutique !== 'string' || typeof brut.cle !== 'string' || typeof brut.secret !== 'string') return null
    return { boutique: brut.boutique, cle: brut.cle, secret: brut.secret }
  } catch {
    return null
  }
}

async function appeler(acces: AccesWoo, chemin: string, parametres: Record<string, string> = {}): Promise<ReponseJson> {
  const url = new URL(`${acces.boutique}/wp-json/${chemin}`)
  for (const [cle, valeur] of Object.entries(parametres)) url.searchParams.set(cle, valeur)
  const jeton = Buffer.from(`${acces.cle}:${acces.secret}`).toString('base64')
  return requeteJson(url, { authorization: `Basic ${jeton}` })
}

/** Le refus d'un appel, dit pour quelqu'un qui peut y remédier. */
export function refusWoo(reponse: ReponseJson): string {
  if (reponse.status === 401 || reponse.status === 403) {
    return 'WooCommerce refuse ces clés. Vérifiez la clé et le secret, et que la clé a bien la permission « Lecture ».'
  }
  if (reponse.status === 404) return 'L’API WooCommerce est introuvable à cette adresse. Vérifiez l’adresse de la boutique, et que les permaliens de WordPress ne sont pas réglés sur « Simple ».'
  if (reponse.status >= 300 && reponse.status < 400) {
    const vers = reponse.entetes.location ?? ''
    return `La boutique redirige ailleurs${vers === '' ? '' : ` (${vers.slice(0, 120)})`} : indiquez directement cette adresse-là.`
  }
  return `La boutique a répondu ${reponse.status}. Réessayez dans un moment.`
}

/** Vérifie les clés avant de les enregistrer : une commande lisible, et rien d'autre. */
export async function verifyWooKey(apiKey: string, champs: Readonly<Record<string, string>> = {}): Promise<KeyVerdict> {
  const secret = apiKey.trim()
  const cle = (champs.cle ?? '').trim()
  if (!/^ck_[a-f0-9]{20,}$/iu.test(cle)) return { ok: false, reason: 'La clé consommateur commence par « ck_ ».' }
  if (!/^cs_[a-f0-9]{20,}$/iu.test(secret)) return { ok: false, reason: 'Le secret consommateur commence par « cs_ ».' }
  let boutique: string
  try {
    boutique = normaliserBoutiqueWoo(champs.boutique ?? '')
  } catch (erreur) {
    return { ok: false, reason: erreur instanceof Error ? erreur.message : 'Adresse de boutique illisible.' }
  }
  const acces: AccesWoo = { boutique, cle, secret }
  const reponse = await appeler(acces, 'wc/v3/orders', { per_page: '1' }).catch((erreur: unknown) => ({
    status: 0,
    corps: null,
    entetes: {},
    erreur: erreur instanceof Error ? erreur.message : '',
  }))
  if (reponse.status === 0) {
    return { ok: false, reason: `La boutique ne répond pas${'erreur' in reponse && reponse.erreur !== '' ? ` : ${reponse.erreur}` : '.'}` }
  }
  if (reponse.status !== 200 || !Array.isArray(reponse.corps)) return { ok: false, reason: refusWoo(reponse) }
  return { ok: true, label: new URL(boutique).host, secret: JSON.stringify(acces), hint: secret }
}

/** Le fuseau du site WordPress : c'est lui qui découpe les journées. */
export async function lireFuseauWoo(acces: AccesWoo): Promise<string> {
  const reponse = await appeler(acces, '').catch(() => null)
  const corps = (reponse?.corps ?? null) as { timezone_string?: string } | null
  return typeof corps?.timezone_string === 'string' && corps.timezone_string !== '' ? corps.timezone_string : ''
}

type CommandeWoo = {
  id: number
  status: string
  currency: string
  date_created_gmt: string | null
  total: string
  customer_id: number
  refunds?: { total: string }[]
  line_items?: { product_id: number; variation_id: number; name: string; quantity: number; total: string }[]
  meta_data?: { key: string; value: unknown }[]
}

/** Les statuts qui ne sont pas une vente : payée ni en cours, ou abandonnée. */
const ECARTES = new Set(['cancelled', 'failed', 'pending', 'checkout-draft', 'trash'])

function centimes(montant: unknown): number {
  const valeur = typeof montant === 'string' ? Number(montant) : typeof montant === 'number' ? montant : NaN
  return Number.isFinite(valeur) ? Math.round(valeur * 100) : 0
}

/**
 * La visite d'origine, telle que WooCommerce l'enregistre depuis sa version 8.5 (« Order
 * Attribution »). Sans elle, l'origine est inconnue — pas « directe ».
 */
export function visiteWoo(meta: CommandeWoo['meta_data']): VisiteShopify | null {
  const lire = (cle: string) => {
    const valeur = meta?.find((entree) => entree.key === `_wc_order_attribution_${cle}`)?.value
    return typeof valeur === 'string' ? valeur : ''
  }
  const type = lire('source_type')
  if (type === '' || type === 'admin' || type === 'mobile_app') return null
  const source = lire('utm_source')
  return {
    source: type === 'typein' ? '' : source,
    referrer: type === 'typein' ? '' : lire('referrer'),
    utm: {
      source: type === 'utm' || type === 'organic' || type === 'referral' ? (source === '(direct)' ? '' : source) : '',
      medium: lire('utm_medium').replace(/^\(none\)$/u, ''),
      campaign: lire('utm_campaign').replace(/^\(none\)$/u, ''),
      content: lire('utm_content'),
      term: lire('utm_term'),
    },
  }
}

export function convertirCommandeWoo(brute: CommandeWoo): CommandeShopify {
  const rembourse = (brute.refunds ?? []).reduce((total, remboursement) => total + centimes(remboursement.total), 0)
  const visite = visiteWoo(brute.meta_data)
  return {
    id: `woo:${brute.id}`,
    creeLe: brute.date_created_gmt === null ? '' : `${brute.date_created_gmt.replace(/Z$/u, '')}Z`,
    // Les remboursements arrivent en négatif : le total encaissé est leur somme avec la commande.
    totalCents: Math.max(0, centimes(brute.total) + rembourse),
    devise: brute.currency,
    annulee: ECARTES.has(brute.status),
    test: false,
    // WooCommerce ne dit pas si c'est la première commande du client : on ne le devine pas.
    premiere: null,
    visite,
    premiereVisite: null,
    clientId: brute.customer_id > 0 ? `woo:${brute.customer_id}` : null,
    lignes: (brute.line_items ?? []).map((ligne) => ({
      produitId: ligne.product_id > 0 ? `woo:${ligne.product_id}` : null,
      varianteId: null,
      titre: ligne.name,
      quantite: ligne.quantity,
      totalCents: centimes(ligne.total),
    })),
  }
}

/** Les commandes créées depuis une date (AAAA-MM-JJ), les plus anciennes d'abord. */
export async function lireCommandesWoo(
  acces: AccesWoo,
  depuis: string,
  max = COMMANDES_WOO_MAX,
): Promise<{ ok: true; commandes: CommandeShopify[]; tronque: boolean } | { ok: false; raison: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(depuis)) throw new Error('Date de début illisible.')
  const commandes: CommandeShopify[] = []
  for (let page = 1; commandes.length < max; page++) {
    const reponse = await appeler(acces, 'wc/v3/orders', {
      after: `${depuis}T00:00:00`,
      dates_are_gmt: 'true',
      per_page: String(PAR_PAGE),
      page: String(page),
      orderby: 'date',
      order: 'asc',
      _fields: 'id,status,currency,date_created_gmt,total,customer_id,refunds,line_items,meta_data',
    })
    if (reponse.status !== 200 || !Array.isArray(reponse.corps)) return { ok: false, raison: refusWoo(reponse) }
    for (const brute of reponse.corps as CommandeWoo[]) {
      if (commandes.length >= max) return { ok: true, commandes, tronque: true }
      commandes.push(convertirCommandeWoo(brute))
    }
    const pages = Number(reponse.entetes['x-wp-totalpages'] ?? '1')
    if (reponse.corps.length < PAR_PAGE || page >= pages) return { ok: true, commandes, tronque: false }
  }
  return { ok: true, commandes, tronque: true }
}

// ── Lina : les clients, reconnus par leurs commandes ────────────────────────

type CommandeClientWoo = {
  id: number
  status: string
  currency: string
  date_created_gmt: string | null
  total: string
  customer_id: number
  billing?: { email?: string }
  refunds?: { total: string }[]
  line_items?: { product_id: number; name: string; quantity: number; total: string }[]
}

/**
 * Les commandes vues par Lina, les plus récentes d'abord, jusqu'à l'échéance.
 *
 * WooCommerce n'a pas d'export en masse : on lit page après page, et l'on s'arrête à
 * l'échéance plutôt que de laisser l'appel dépasser le temps d'une fonction. Ce qui reste
 * alors est l'histoire la plus récente, dite « partielle ».
 *
 * Un client inscrit se reconnaît à son numéro. Un achat sans compte n'en a pas : il se
 * reconnaît à son courriel, **transformé aussitôt** par `pseudonyme` en une empreinte qui ne
 * se retourne pas. Le courriel n'est ni gardé, ni écrit, ni journalisé.
 */
export async function lireCommandesClientsWoo(
  acces: AccesWoo,
  depuis: string,
  options: { max: number; echeance: number; pseudonyme: (courriel: string) => string },
): Promise<{ ok: true; commandes: CommandeExportWoo[]; tronque: boolean; sansClient: number } | { ok: false; raison: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(depuis)) throw new Error('Date de début illisible.')
  const commandes: CommandeExportWoo[] = []
  let sansClient = 0
  for (let page = 1; ; page++) {
    if (commandes.length >= options.max || Date.now() > options.echeance) return { ok: true, commandes, tronque: true, sansClient }
    const reponse = await appeler(acces, 'wc/v3/orders', {
      after: `${depuis}T00:00:00`,
      dates_are_gmt: 'true',
      per_page: String(PAR_PAGE),
      page: String(page),
      orderby: 'date',
      order: 'desc',
      _fields: 'id,status,currency,date_created_gmt,total,customer_id,billing.email,refunds,line_items',
    })
    if (reponse.status !== 200 || !Array.isArray(reponse.corps)) return { ok: false, raison: refusWoo(reponse) }
    for (const brute of reponse.corps as CommandeClientWoo[]) {
      if (ECARTES.has(brute.status) || brute.status === 'refunded' || brute.date_created_gmt === null) continue
      const courriel = brute.billing?.email?.trim().toLowerCase() ?? ''
      const clientRef = brute.customer_id > 0 ? `c${brute.customer_id}` : courriel.includes('@') ? `g${options.pseudonyme(courriel)}` : null
      if (clientRef === null) sansClient += 1
      const rembourse = (brute.refunds ?? []).reduce((total, remboursement) => total + centimes(remboursement.total), 0)
      commandes.push({
        id: `woo:${brute.id}`,
        creeLe: `${brute.date_created_gmt.replace(/Z$/u, '')}Z`,
        clientRef,
        totalCents: Math.max(0, centimes(brute.total) + rembourse),
        devise: brute.currency,
        lignes: (brute.line_items ?? [])
          .filter((ligne) => ligne.product_id > 0 && ligne.quantity > 0)
          .map((ligne) => ({
            produitRef: String(ligne.product_id),
            titre: ligne.name,
            type: '',
            quantite: ligne.quantity,
            prixUnitaireCents: Math.round(centimes(ligne.total) / ligne.quantity),
          })),
      })
    }
    const pages = Number(reponse.entetes['x-wp-totalpages'] ?? '1')
    if (reponse.corps.length < PAR_PAGE || page >= pages) return { ok: true, commandes, tronque: false, sansClient }
  }
}

/** La forme des commandes que Lina analyse (celle de l'export Shopify). */
export type CommandeExportWoo = {
  id: string
  creeLe: string
  clientRef: string | null
  totalCents: number
  devise: string
  lignes: { produitRef: string; titre: string; type: string; quantite: number; prixUnitaireCents: number }[]
}
