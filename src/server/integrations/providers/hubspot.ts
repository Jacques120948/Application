import type { KeyVerdict } from '../verify'

/**
 * HubSpot, en lecture seule, pour que Nova sache combien de prospects deviennent clients.
 *
 * La personne crée une « application privée » dans HubSpot (Paramètres → Intégrations →
 * Applications privées) avec deux droits de lecture — contacts et transactions — et colle
 * le jeton. Aucun mot de passe, et le jeton se révoque d'un clic.
 *
 * Ce qui est lu d'un contact : sa date de création, sa source d'origine telle que HubSpot la
 * range, et la date à laquelle il est devenu client. Ni nom, ni courriel, ni téléphone : on
 * ne demande pas ces propriétés, elles ne traversent donc jamais le réseau. D'une transaction
 * gagnée : son montant, sa devise, ses dates, sa source.
 */

const API = 'https://api.hubapi.com'
/** La recherche HubSpot ne rend pas plus de dix mille résultats par requête : on le dit. */
export const RESULTATS_MAX = 10_000
const PAR_PAGE = 100

type Reponse = { status: number; corps: Record<string, unknown> | null }

async function appeler(jeton: string, chemin: string, corps?: unknown): Promise<Reponse> {
  const reponse = await fetch(`${API}/${chemin}`, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    signal: AbortSignal.timeout(20_000),
  })
  return { status: reponse.status, corps: (await reponse.json().catch(() => null)) as Record<string, unknown> | null }
}

/** Le refus de HubSpot, dit pour quelqu'un qui peut y remédier. Jamais le jeton. */
export function refusHubspot(reponse: Reponse, quoi: string): string {
  if (reponse.status === 401) return 'HubSpot refuse ce jeton : l’application privée a peut-être été supprimée ou son jeton renouvelé. Collez le nouveau jeton.'
  if (reponse.status === 403) return `Le jeton n’a pas le droit de lire ${quoi}. Dans l’application privée HubSpot, onglet « Scopes », cochez la lecture correspondante.`
  if (reponse.status === 429) return 'HubSpot demande de ralentir. Nova réessaiera plus tard.'
  return `HubSpot a répondu ${reponse.status}. Réessayez dans un moment.`
}

export async function verifyHubspotToken(apiKey: string): Promise<KeyVerdict> {
  const jeton = apiKey.trim()
  if (!/^pat-[a-z]{2}\d-[0-9a-f-]{20,}$/iu.test(jeton)) {
    return { ok: false, reason: 'Un jeton d’application privée HubSpot commence par « pat-eu1- » ou « pat-na1- ».' }
  }
  const [contacts, affaires] = await Promise.all([
    appeler(jeton, 'crm/v3/objects/contacts?limit=1&properties=createdate').catch(() => null),
    appeler(jeton, 'crm/v3/objects/deals?limit=1&properties=closedate').catch(() => null),
  ])
  if (contacts === null || affaires === null) return { ok: false, reason: 'HubSpot ne répond pas. Réessayez dans un moment.' }
  if (contacts.status !== 200) return { ok: false, reason: refusHubspot(contacts, 'les contacts (crm.objects.contacts.read)') }
  if (affaires.status !== 200) return { ok: false, reason: refusHubspot(affaires, 'les transactions (crm.objects.deals.read)') }
  const compte = await appeler(jeton, 'account-info/v3/details').catch(() => null)
  const portail = compte?.status === 200 ? (compte.corps?.portalId as number | undefined) : undefined
  return { ok: true, label: portail === undefined ? 'HubSpot' : `HubSpot · portail ${portail}`, hint: jeton }
}

/** Le fuseau et la devise du compte, quand HubSpot les donne. */
export async function lireCompteHubspot(jeton: string): Promise<{ fuseau: string; devise: string }> {
  const compte = await appeler(jeton, 'account-info/v3/details').catch(() => null)
  const corps = compte?.status === 200 ? compte.corps : null
  return {
    fuseau: typeof corps?.timeZone === 'string' ? corps.timeZone : '',
    devise: typeof corps?.companyCurrency === 'string' ? corps.companyCurrency : '',
  }
}

export type ContactCrm = {
  /** Horodatage ISO de la création : le jour où il est devenu un prospect. */
  cree: string
  /** Horodatage ISO du passage au stade « client », `null` s'il ne l'est pas (encore). */
  client: string | null
  /** La source d'origine selon HubSpot (ORGANIC_SEARCH, PAID_SOCIAL…). */
  source: string
}

export type AffaireCrm = { gagnee: string; creee: string; montantCents: number; devise: string; source: string }

async function chercher<T>(
  jeton: string,
  objet: 'contacts' | 'deals',
  filtres: { propertyName: string; operator: string; value: string }[],
  proprietes: string[],
  tri: string,
  quoi: string,
): Promise<{ ok: true; lignes: T[]; tronque: boolean } | { ok: false; raison: string }> {
  const lignes: T[] = []
  let apres: string | undefined
  while (lignes.length < RESULTATS_MAX) {
    const reponse = await appeler(jeton, `crm/v3/objects/${objet}/search`, {
      filterGroups: [{ filters: filtres }],
      properties: proprietes,
      sorts: [{ propertyName: tri, direction: 'ASCENDING' }],
      limit: PAR_PAGE,
      ...(apres === undefined ? {} : { after: apres }),
    })
    if (reponse.status !== 200 || reponse.corps === null) return { ok: false, raison: refusHubspot(reponse, quoi) }
    const resultats = (reponse.corps.results ?? []) as { properties?: T }[]
    for (const resultat of resultats) if (resultat.properties !== undefined) lignes.push(resultat.properties)
    const suivant = (reponse.corps.paging as { next?: { after?: string } } | undefined)?.next?.after
    if (suivant === undefined || resultats.length === 0) return { ok: true, lignes, tronque: false }
    apres = suivant
  }
  return { ok: true, lignes, tronque: true }
}

function iso(valeur: unknown): string | null {
  if (typeof valeur !== 'string' || valeur === '') return null
  const date = new Date(/^\d+$/u.test(valeur) ? Number(valeur) : valeur)
  return Number.isNaN(+date) ? null : date.toISOString()
}

/**
 * Les contacts créés depuis une date, et ceux devenus clients depuis cette date (un prospect
 * d'avant peut signer maintenant). Aucun identifiant n'en sort : seulement des dates et une
 * source par contact, que l'agrégation réduit aussitôt à des comptes.
 */
export async function lireContacts(
  jeton: string,
  depuis: string,
): Promise<{ ok: true; contacts: ContactCrm[]; tronque: boolean } | { ok: false; raison: string }> {
  const debut = String(Date.parse(`${depuis}T00:00:00Z`))
  const proprietes = ['createdate', 'hs_analytics_source', 'hs_lifecyclestage_customer_date']
  type Brut = { createdate?: string; hs_analytics_source?: string; hs_lifecyclestage_customer_date?: string; hs_object_id?: string }
  const [crees, devenus] = await Promise.all([
    chercher<Brut>(jeton, 'contacts', [{ propertyName: 'createdate', operator: 'GTE', value: debut }], proprietes, 'createdate', 'les contacts'),
    chercher<Brut>(jeton, 'contacts', [{ propertyName: 'hs_lifecyclestage_customer_date', operator: 'GTE', value: debut }], proprietes, 'hs_lifecyclestage_customer_date', 'les contacts'),
  ])
  if (!crees.ok) return crees
  if (!devenus.ok) return devenus
  // Un contact créé et devenu client dans la fenêtre figure dans les deux listes : une seule fois.
  const vus = new Set<string>()
  const contacts: ContactCrm[] = []
  for (const brut of [...crees.lignes, ...devenus.lignes]) {
    const cle = brut.hs_object_id ?? `${brut.createdate}|${brut.hs_lifecyclestage_customer_date}`
    if (vus.has(cle)) continue
    vus.add(cle)
    const cree = iso(brut.createdate)
    if (cree === null) continue
    contacts.push({ cree, client: iso(brut.hs_lifecyclestage_customer_date), source: brut.hs_analytics_source ?? '' })
  }
  return { ok: true, contacts, tronque: crees.tronque || devenus.tronque }
}

/** Les transactions gagnées depuis une date. */
export async function lireAffaires(
  jeton: string,
  depuis: string,
): Promise<{ ok: true; affaires: AffaireCrm[]; tronque: boolean } | { ok: false; raison: string }> {
  const lecture = await chercher<{ amount?: string; closedate?: string; createdate?: string; deal_currency_code?: string; hs_analytics_source?: string }>(
    jeton,
    'deals',
    [
      { propertyName: 'closedate', operator: 'GTE', value: String(Date.parse(`${depuis}T00:00:00Z`)) },
      { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'true' },
    ],
    ['amount', 'closedate', 'createdate', 'deal_currency_code', 'hs_analytics_source'],
    'closedate',
    'les transactions',
  )
  if (!lecture.ok) return lecture
  const affaires: AffaireCrm[] = []
  for (const brut of lecture.lignes) {
    const gagnee = iso(brut.closedate)
    const creee = iso(brut.createdate)
    const montant = Number(brut.amount)
    if (gagnee === null || creee === null) continue
    affaires.push({
      gagnee,
      creee,
      montantCents: Number.isFinite(montant) ? Math.round(montant * 100) : 0,
      devise: (brut.deal_currency_code ?? '').toUpperCase(),
      source: brut.hs_analytics_source ?? '',
    })
  }
  return { ok: true, affaires, tronque: lecture.tronque }
}

// ── Lina : les clients, reconnus par leurs affaires gagnées ─────────────────

export type AffaireClient = { id: string; creeLe: string; clientRef: string | null; totalCents: number; devise: string; lignes: [] }

/** Le numéro du portail HubSpot : de quoi ouvrir la fiche d'un contact, rien d'autre. */
export async function lirePortailHubspot(jeton: string): Promise<string> {
  const compte = await appeler(jeton, 'account-info/v3/details').catch(() => null)
  const portail = compte?.status === 200 ? compte.corps?.portalId : null
  return typeof portail === 'number' || typeof portail === 'string' ? String(portail) : ''
}

/**
 * Pour Lina, dans une activité de services : chaque affaire gagnée est une « commande », et
 * son client est le contact associé (le premier, quand il y en a plusieurs). On lit le
 * montant, la date, la devise, et l'identifiant du contact — ni son nom, ni son courriel,
 * ni sa société. Le droit de lecture des contacts suffit pour les associations.
 */
export async function lireAffairesClients(
  jeton: string,
  depuis: string,
  options: { max: number; echeance: number },
): Promise<{ ok: true; commandes: AffaireClient[]; tronque: boolean; sansClient: number } | { ok: false; raison: string }> {
  type Brut = { id?: string; properties?: { amount?: string; closedate?: string; deal_currency_code?: string } }
  const affaires: { id: string; gagnee: string; montantCents: number; devise: string }[] = []
  let apres: string | undefined
  let tronque = false
  for (;;) {
    if (affaires.length >= Math.min(options.max, RESULTATS_MAX) || Date.now() > options.echeance) {
      tronque = true
      break
    }
    const reponse = await appeler(jeton, 'crm/v3/objects/deals/search', {
      filterGroups: [
        {
          filters: [
            { propertyName: 'closedate', operator: 'GTE', value: String(Date.parse(`${depuis}T00:00:00Z`)) },
            { propertyName: 'hs_is_closed_won', operator: 'EQ', value: 'true' },
          ],
        },
      ],
      properties: ['amount', 'closedate', 'deal_currency_code'],
      sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
      limit: PAR_PAGE,
      ...(apres === undefined ? {} : { after: apres }),
    })
    if (reponse.status !== 200 || reponse.corps === null) return { ok: false, raison: refusHubspot(reponse, 'les transactions') }
    const resultats = (reponse.corps.results ?? []) as Brut[]
    for (const brut of resultats) {
      const gagnee = iso(brut.properties?.closedate)
      if (brut.id === undefined || gagnee === null) continue
      const montant = Number(brut.properties?.amount)
      affaires.push({
        id: brut.id,
        gagnee,
        montantCents: Number.isFinite(montant) ? Math.max(0, Math.round(montant * 100)) : 0,
        devise: (brut.properties?.deal_currency_code ?? '').toUpperCase(),
      })
    }
    apres = (reponse.corps.paging as { next?: { after?: string } } | undefined)?.next?.after
    if (apres === undefined || resultats.length === 0) break
  }

  // Le contact de chaque affaire, cent affaires à la fois.
  const contactDe = new Map<string, string>()
  for (let debut = 0; debut < affaires.length; debut += PAR_PAGE) {
    if (Date.now() > options.echeance) {
      tronque = true
      break
    }
    const lot = affaires.slice(debut, debut + PAR_PAGE)
    const reponse = await appeler(jeton, 'crm/v4/associations/deals/contacts/batch/read', { inputs: lot.map((affaire) => ({ id: affaire.id })) })
    if (reponse.status !== 200 && reponse.status !== 207) return { ok: false, raison: refusHubspot(reponse, 'les contacts associés aux transactions') }
    for (const resultat of (reponse.corps?.results ?? []) as { from?: { id?: string }; to?: { toObjectId?: number | string }[] }[]) {
      const premier = resultat.to?.[0]?.toObjectId
      if (resultat.from?.id !== undefined && premier !== undefined) contactDe.set(resultat.from.id, String(premier))
    }
  }
  let sansClient = 0
  const commandes = affaires.map((affaire) => {
    const client = contactDe.get(affaire.id) ?? null
    if (client === null) sansClient += 1
    return { id: `hubspot:${affaire.id}`, creeLe: affaire.gagnee, clientRef: client, totalCents: affaire.montantCents, devise: affaire.devise, lignes: [] as [] }
  })
  return { ok: true, commandes, tronque, sansClient }
}
