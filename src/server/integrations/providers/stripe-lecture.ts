import type { CommandeShopify } from './shopify'
import type { KeyVerdict } from '../verify'

/**
 * Stripe en lecture, pour Nova : les abonnements (MRR, churn, cohortes) et les encaissements.
 *
 * Ce n'est pas la connexion Stripe des applications publiées (providers/stripe.ts), qui
 * encaisse. Celle-ci ne fait que lire, et elle n'accepte qu'une **clé restreinte** : une clé
 * secrète ordinaire (« sk_ ») permet de rembourser, de virer, de tout modifier, et Evoliia n'a
 * aucune raison de la détenir. La personne crée une clé restreinte avec la lecture des
 * abonnements et des paiements, et rien d'autre.
 *
 * Ce qui est gardé : des totaux. Aucun client, aucun identifiant d'abonnement.
 */

const API = 'https://api.stripe.com/v1'
export const ABONNEMENTS_MAX = 5_000
export const ENCAISSEMENTS_MAX = 5_000
const PAR_PAGE = 100

type Reponse = { status: number; corps: Record<string, unknown> | null }

async function appeler(cle: string, chemin: string, parametres: Record<string, string> = {}): Promise<Reponse> {
  const url = new URL(`${API}/${chemin}`)
  for (const [nom, valeur] of Object.entries(parametres)) url.searchParams.append(nom, valeur)
  const reponse = await fetch(url, {
    headers: { authorization: `Bearer ${cle}`, 'stripe-version': '2024-06-20' },
    signal: AbortSignal.timeout(20_000),
  })
  const corps = (await reponse.json().catch(() => null)) as Record<string, unknown> | null
  return { status: reponse.status, corps }
}

/** Le refus de Stripe, dit pour quelqu'un qui peut y remédier. Jamais la clé. */
export function refusStripe(reponse: Reponse, quoi: string): string {
  if (reponse.status === 401) return 'Stripe refuse cette clé : elle a peut-être été supprimée. Créez-en une nouvelle et reconnectez Stripe.'
  if (reponse.status === 403) return `La clé restreinte n’a pas le droit de lire ${quoi}. Dans Stripe, modifiez la clé et donnez « Lecture » à ${quoi}.`
  if (reponse.status === 429) return 'Stripe demande de ralentir. Nova réessaiera plus tard.'
  return `Stripe a répondu ${reponse.status}. Réessayez dans un moment.`
}

export async function verifyStripeLecture(apiKey: string): Promise<KeyVerdict> {
  const cle = apiKey.trim()
  if (/^sk_/u.test(cle)) {
    return {
      ok: false,
      reason:
        'C’est une clé secrète complète : elle permettrait de rembourser, de virer et de tout modifier. Créez plutôt une clé restreinte (« rk_… ») avec la seule lecture des abonnements et des paiements.',
    }
  }
  if (/^pk_/u.test(cle)) return { ok: false, reason: 'C’est une clé publiable : elle ne lit rien. Il faut une clé restreinte (« rk_… »).' }
  if (!/^rk_(live|test)_[A-Za-z0-9]{20,}$/u.test(cle)) return { ok: false, reason: 'Une clé restreinte Stripe commence par « rk_live_ » ou « rk_test_ ».' }
  const [abonnements, paiements] = await Promise.all([
    appeler(cle, 'subscriptions', { limit: '1', status: 'all' }).catch(() => null),
    appeler(cle, 'charges', { limit: '1' }).catch(() => null),
  ])
  if (abonnements === null || paiements === null) return { ok: false, reason: 'Stripe ne répond pas. Réessayez dans un moment.' }
  if (abonnements.status !== 200) return { ok: false, reason: refusStripe(abonnements, 'les abonnements (Subscriptions)') }
  if (paiements.status !== 200) return { ok: false, reason: refusStripe(paiements, 'les paiements (Charges)') }
  return { ok: true, label: cle.startsWith('rk_test_') ? 'Stripe · mode test' : 'Stripe', hint: cle }
}

/** Un abonnement, réduit à ce qui compte pour le MRR. */
export type Abonnement = {
  /** Premier jour payant (après un éventuel essai), AAAA-MM-JJ. */
  debut: string
  /** Dernier jour, AAAA-MM-JJ, ou `null` s'il court encore. */
  fin: string | null
  /** Montant mensuel en centimes, au prix actuel. `null` : prix à paliers ou à l'usage, non chiffrable. */
  mensuelCents: number | null
  devise: string
  /** En essai gratuit aujourd'hui : compté à part, jamais dans le MRR. */
  essai: boolean
}

type PrixBrut = { unit_amount?: number | null; recurring?: { interval?: string; interval_count?: number } | null }
type AbonnementBrut = {
  status: string
  start_date: number
  trial_end?: number | null
  ended_at?: number | null
  currency: string
  items?: { data?: { quantity?: number; price?: PrixBrut | null }[] }
}

function jour(secondes: number): string {
  return new Date(secondes * 1000).toISOString().slice(0, 10)
}

/** Un prix récurrent ramené au mois. Stripe facture au jour, à la semaine, au mois ou à l'année. */
export function mensuel(prix: PrixBrut | null | undefined, quantite: number): number | null {
  if (prix == null || typeof prix.unit_amount !== 'number' || prix.recurring == null) return null
  const n = Math.max(1, prix.recurring.interval_count ?? 1)
  const parMois: Record<string, number> = { day: 365 / 12, week: 52 / 12, month: 1, year: 1 / 12 }
  const facteur = parMois[prix.recurring.interval ?? '']
  if (facteur === undefined) return null
  return Math.round((prix.unit_amount * quantite * facteur) / n)
}

/** Les statuts qui n'ont jamais été un abonnement payant : paiement initial jamais abouti. */
const JAMAIS_COMMENCES = new Set(['incomplete', 'incomplete_expired'])

export function convertirAbonnement(brut: AbonnementBrut, maintenant: Date): Abonnement | null {
  if (JAMAIS_COMMENCES.has(brut.status)) return null
  const payantDepuis = Math.max(brut.start_date, brut.trial_end ?? 0)
  const fin = brut.ended_at ?? null
  // Terminé pendant l'essai : n'a jamais payé, ce n'est pas un abonné perdu.
  if (fin !== null && fin <= payantDepuis) return null
  let total = 0
  let chiffrable = true
  for (const item of brut.items?.data ?? []) {
    const montant = mensuel(item.price, item.quantity ?? 1)
    if (montant === null) chiffrable = false
    else total += montant
  }
  return {
    debut: jour(payantDepuis),
    fin: fin === null ? null : jour(fin),
    mensuelCents: chiffrable ? total : null,
    devise: brut.currency.toUpperCase(),
    essai: brut.status === 'trialing' && payantDepuis * 1000 > +maintenant,
  }
}

async function paginer<T>(
  cle: string,
  chemin: string,
  parametres: Record<string, string>,
  max: number,
  quoi: string,
): Promise<{ ok: true; lignes: T[]; tronque: boolean } | { ok: false; raison: string }> {
  const lignes: T[] = []
  let apres: string | null = null
  while (lignes.length < max) {
    const reponse = await appeler(cle, chemin, { ...parametres, limit: String(PAR_PAGE), ...(apres === null ? {} : { starting_after: apres }) })
    if (reponse.status !== 200 || reponse.corps === null) return { ok: false, raison: refusStripe(reponse, quoi) }
    const page = (reponse.corps.data ?? []) as (T & { id: string })[]
    lignes.push(...page)
    if (reponse.corps.has_more !== true || page.length === 0) return { ok: true, lignes, tronque: false }
    apres = page.at(-1)!.id
  }
  return { ok: true, lignes: lignes.slice(0, max), tronque: true }
}

/** Tous les abonnements, en cours comme terminés : c'est l'historique qui donne le churn. */
export async function lireAbonnements(
  cle: string,
  maintenant = new Date(),
): Promise<{ ok: true; abonnements: Abonnement[]; tronque: boolean } | { ok: false; raison: string }> {
  const lecture = await paginer<AbonnementBrut>(cle, 'subscriptions', { status: 'all' }, ABONNEMENTS_MAX, 'les abonnements (Subscriptions)')
  if (!lecture.ok) return lecture
  return {
    ok: true,
    abonnements: lecture.lignes.map((brut) => convertirAbonnement(brut, maintenant)).filter((un): un is Abonnement => un !== null),
    tronque: lecture.tronque,
  }
}

type PaiementBrut = { id: string; amount: number; amount_refunded: number; currency: string; created: number; status: string; paid: boolean }

/** Les paiements réussis depuis une date, en « commandes » sans produit ni visite. */
export async function lireEncaissements(
  cle: string,
  depuis: string,
): Promise<{ ok: true; commandes: CommandeShopify[]; tronque: boolean } | { ok: false; raison: string }> {
  const depuisSecondes = Math.floor(Date.parse(`${depuis}T00:00:00Z`) / 1000)
  const lecture = await paginer<PaiementBrut>(cle, 'charges', { 'created[gte]': String(depuisSecondes) }, ENCAISSEMENTS_MAX, 'les paiements (Charges)')
  if (!lecture.ok) return lecture
  return {
    ok: true,
    tronque: lecture.tronque,
    commandes: lecture.lignes.map((paiement) => ({
      id: `stripe:${paiement.id}`,
      creeLe: new Date(paiement.created * 1000).toISOString(),
      totalCents: Math.max(0, paiement.amount - paiement.amount_refunded),
      devise: paiement.currency.toUpperCase(),
      annulee: paiement.status !== 'succeeded' || !paiement.paid,
      test: false,
      premiere: null,
      visite: null,
      premiereVisite: null,
      clientId: null,
      lignes: [],
    })),
  }
}

// ── Lina : les clients, reconnus par leurs paiements ────────────────────────

type PaiementClientBrut = PaiementBrut & { customer: string | null }

/**
 * Les paiements réussis rattachés à un client Stripe, les plus récents d'abord, jusqu'à
 * l'échéance. Un paiement sans client (lien de paiement anonyme) est compté, pas rattaché :
 * Lina ne lit ni courriel ni nom. Les produits ne sont pas lus : un paiement n'en dit rien.
 */
export async function lireEncaissementsClients(
  cle: string,
  depuis: string,
  options: { max: number; echeance: number },
): Promise<
  | { ok: true; commandes: { id: string; creeLe: string; clientRef: string | null; totalCents: number; devise: string; lignes: [] }[]; tronque: boolean; sansClient: number }
  | { ok: false; raison: string }
> {
  const depuisSecondes = Math.floor(Date.parse(`${depuis}T00:00:00Z`) / 1000)
  const commandes: { id: string; creeLe: string; clientRef: string | null; totalCents: number; devise: string; lignes: [] }[] = []
  let sansClient = 0
  let apres: string | null = null
  for (;;) {
    if (commandes.length >= options.max || Date.now() > options.echeance) return { ok: true, commandes, tronque: true, sansClient }
    const reponse = await appeler(cle, 'charges', { 'created[gte]': String(depuisSecondes), limit: String(PAR_PAGE), ...(apres === null ? {} : { starting_after: apres }) })
    if (reponse.status !== 200 || reponse.corps === null) return { ok: false, raison: refusStripe(reponse, 'les paiements (Charges)') }
    const page = (reponse.corps.data ?? []) as PaiementClientBrut[]
    for (const paiement of page) {
      if (paiement.status !== 'succeeded' || !paiement.paid) continue
      const montant = Math.max(0, paiement.amount - paiement.amount_refunded)
      if (montant === 0) continue
      const client = typeof paiement.customer === 'string' && paiement.customer.startsWith('cus_') ? paiement.customer : null
      if (client === null) sansClient += 1
      commandes.push({ id: `stripe:${paiement.id}`, creeLe: new Date(paiement.created * 1000).toISOString(), clientRef: client, totalCents: montant, devise: paiement.currency.toUpperCase(), lignes: [] })
    }
    if (reponse.corps.has_more !== true || page.length === 0) return { ok: true, commandes, tronque: false, sansClient }
    apres = page.at(-1)!.id
  }
}
