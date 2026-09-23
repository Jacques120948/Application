import type { KeyVerdict } from '../verify'

/**
 * Les outils d'emailing, en lecture seule, pour que Lina relise les résultats des campagnes.
 *
 * Trois outils, un seul besoin : les statistiques agrégées de chaque campagne envoyée — envois,
 * ouvertures et clics uniques, commandes et chiffre d'affaires quand l'outil les attribue,
 * désinscriptions. **Aucun destinataire n'est demandé** : ni liste, ni profil, ni courriel.
 *
 * Chaque clé appartient à la personne et se crée dans son compte ; aucune ne coûte rien à
 * Evoliia. Une statistique que l'outil ne donne pas reste `null` — jamais zéro : Brevo ne
 * mesure pas le chiffre d'affaires, et l'écran doit pouvoir le dire.
 */

export type CampagneEmail = {
  /** L'identifiant de la campagne chez l'outil : de quoi la reconnaître d'une lecture à l'autre. */
  ref: string
  nom: string
  envoyeLe: string | null
  envoyes: number
  ouvertures: number | null
  clics: number | null
  conversions: number | null
  caCents: number | null
  desinscriptions: number | null
}

export type LectureEmailing = { ok: true; campagnes: CampagneEmail[] } | { ok: false; raison: string }

const DELAI_MS = 20_000
/** Les campagnes lues au plus : les plus récentes, celles qu'on compare. */
export const CAMPAGNES_MAX = 50

async function json(url: string, init: RequestInit): Promise<{ status: number; corps: Record<string, unknown> | null }> {
  const reponse = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(DELAI_MS) })
  return { status: reponse.status, corps: (await reponse.json().catch(() => null)) as Record<string, unknown> | null }
}

function refus(outil: string, status: number): string {
  if (status === 401) return `${outil} refuse cette clé : elle a peut-être été supprimée. Créez-en une nouvelle et collez-la.`
  if (status === 403) return `La clé ${outil} n’a pas les droits de lecture nécessaires. Voyez le guide de connexion.`
  if (status === 429) return `${outil} demande de ralentir. Lina réessaiera plus tard.`
  return `${outil} a répondu ${status}. Réessayez dans un moment.`
}

function centimes(valeur: unknown): number | null {
  const nombre = typeof valeur === 'string' ? Number(valeur) : typeof valeur === 'number' ? valeur : NaN
  return Number.isFinite(nombre) ? Math.round(nombre * 100) : null
}

function entier(valeur: unknown): number | null {
  const nombre = typeof valeur === 'string' ? Number(valeur) : typeof valeur === 'number' ? valeur : NaN
  return Number.isFinite(nombre) ? Math.round(nombre) : null
}

// ── Klaviyo ─────────────────────────────────────────────────────────────────

const KLAVIYO = 'https://a.klaviyo.com/api'
const REVISION = '2024-10-15'

function enTetesKlaviyo(cle: string): HeadersInit {
  return { authorization: `Klaviyo-API-Key ${cle}`, revision: REVISION, accept: 'application/json', 'content-type': 'application/vnd.api+json' }
}

export async function verifyKlaviyoKey(apiKey: string): Promise<KeyVerdict> {
  const cle = apiKey.trim()
  if (!/^pk_[A-Za-z0-9]{20,}$/u.test(cle)) return { ok: false, reason: 'Une clé privée Klaviyo commence par « pk_ ».' }
  const [campagnes, metriques] = await Promise.all([
    json(`${KLAVIYO}/campaigns?filter=${encodeURIComponent("equals(messages.channel,'email')")}`, { headers: enTetesKlaviyo(cle) }).catch(() => null),
    json(`${KLAVIYO}/metrics`, { headers: enTetesKlaviyo(cle) }).catch(() => null),
  ])
  if (campagnes === null || metriques === null) return { ok: false, reason: 'Klaviyo ne répond pas. Réessayez dans un moment.' }
  if (campagnes.status !== 200) return { ok: false, reason: refus('Klaviyo', campagnes.status) }
  if (metriques.status !== 200) return { ok: false, reason: refus('Klaviyo', metriques.status) }
  return { ok: true, label: 'Klaviyo', hint: cle }
}

export async function lireKlaviyo(cle: string): Promise<LectureEmailing> {
  const campagnes = await json(
    `${KLAVIYO}/campaigns?filter=${encodeURIComponent("equals(messages.channel,'email')")}&fields[campaign]=name,status,send_time&sort=-created_at`,
    { headers: enTetesKlaviyo(cle) },
  )
  if (campagnes.status !== 200) return { ok: false, raison: refus('Klaviyo', campagnes.status) }
  const envoyees = ((campagnes.corps?.data ?? []) as { id: string; attributes?: { name?: string; status?: string; send_time?: string | null } }[])
    .filter((campagne) => campagne.attributes?.status === 'Sent')
    .slice(0, CAMPAGNES_MAX)
  if (envoyees.length === 0) return { ok: true, campagnes: [] }

  // La métrique de conversion : « Placed Order », celle que Klaviyo attribue aux campagnes.
  const metriques = await json(`${KLAVIYO}/metrics?fields[metric]=name`, { headers: enTetesKlaviyo(cle) })
  const commande = ((metriques.corps?.data ?? []) as { id: string; attributes?: { name?: string } }[]).find((metrique) => metrique.attributes?.name === 'Placed Order')
  const rapport = await json(`${KLAVIYO}/campaign-values-reports`, {
    method: 'POST',
    headers: enTetesKlaviyo(cle),
    body: JSON.stringify({
      data: {
        type: 'campaign-values-report',
        attributes: {
          statistics: ['recipients', 'opens_unique', 'clicks_unique', 'unsubscribes', ...(commande === undefined ? [] : ['conversions', 'conversion_value'])],
          timeframe: { key: 'last_365_days' },
          ...(commande === undefined ? {} : { conversion_metric_id: commande.id }),
          filter: `contains-any(campaign_id,[${envoyees.map((campagne) => `"${campagne.id}"`).join(',')}])`,
        },
      },
    }),
  })
  if (rapport.status !== 200) return { ok: false, raison: refus('Klaviyo', rapport.status) }
  const resultats = ((rapport.corps?.data as { attributes?: { results?: unknown[] } } | undefined)?.attributes?.results ?? []) as {
    groupings?: { campaign_id?: string }
    statistics?: Record<string, number>
  }[]
  const parCampagne = new Map<string, Record<string, number>>()
  for (const resultat of resultats) {
    const id = resultat.groupings?.campaign_id
    if (id === undefined) continue
    // Une campagne peut avoir plusieurs messages : on les additionne.
    const cumul = parCampagne.get(id) ?? {}
    for (const [cle2, valeur] of Object.entries(resultat.statistics ?? {})) cumul[cle2] = (cumul[cle2] ?? 0) + (Number(valeur) || 0)
    parCampagne.set(id, cumul)
  }
  return {
    ok: true,
    campagnes: envoyees.flatMap((campagne) => {
      const stats = parCampagne.get(campagne.id)
      if (stats === undefined || !stats.recipients) return []
      return [
        {
          ref: campagne.id,
          nom: campagne.attributes?.name ?? 'Campagne Klaviyo',
          envoyeLe: campagne.attributes?.send_time?.slice(0, 10) ?? null,
          envoyes: entier(stats.recipients) ?? 0,
          ouvertures: entier(stats.opens_unique),
          clics: entier(stats.clicks_unique),
          conversions: commande === undefined ? null : entier(stats.conversions),
          caCents: commande === undefined ? null : centimes(stats.conversion_value),
          desinscriptions: entier(stats.unsubscribes),
        },
      ]
    }),
  }
}

// ── Brevo ───────────────────────────────────────────────────────────────────

const BREVO = 'https://api.brevo.com/v3'

export async function verifyBrevoKey(apiKey: string): Promise<KeyVerdict> {
  const cle = apiKey.trim()
  if (!/^xkeysib-[A-Za-z0-9-]{20,}$/u.test(cle)) return { ok: false, reason: 'Une clé API Brevo commence par « xkeysib- ».' }
  const compte = await json(`${BREVO}/account`, { headers: { 'api-key': cle, accept: 'application/json' } }).catch(() => null)
  if (compte === null) return { ok: false, reason: 'Brevo ne répond pas. Réessayez dans un moment.' }
  if (compte.status !== 200) return { ok: false, reason: refus('Brevo', compte.status) }
  const societe = (compte.corps?.companyName as string | undefined) ?? ''
  return { ok: true, label: societe === '' ? 'Brevo' : `Brevo · ${societe}`, hint: cle }
}

export async function lireBrevo(cle: string): Promise<LectureEmailing> {
  const reponse = await json(`${BREVO}/emailCampaigns?status=sent&limit=${CAMPAGNES_MAX}&sort=desc&statistics=globalStats`, {
    headers: { 'api-key': cle, accept: 'application/json' },
  })
  if (reponse.status !== 200) return { ok: false, raison: refus('Brevo', reponse.status) }
  const campagnes = (reponse.corps?.campaigns ?? []) as {
    id: number
    name?: string
    sentDate?: string
    statistics?: { globalStats?: Record<string, number> }
  }[]
  return {
    ok: true,
    campagnes: campagnes.flatMap((campagne) => {
      const stats = campagne.statistics?.globalStats
      const envoyes = entier(stats?.sent) ?? 0
      if (envoyes === 0) return []
      return [
        {
          ref: String(campagne.id),
          nom: campagne.name ?? 'Campagne Brevo',
          envoyeLe: campagne.sentDate?.slice(0, 10) ?? null,
          envoyes,
          ouvertures: entier(stats?.uniqueViews),
          clics: entier(stats?.uniqueClicks),
          // Brevo n'attribue pas de commandes aux campagnes : ni conversions ni chiffre d'affaires.
          conversions: null,
          caCents: null,
          desinscriptions: entier(stats?.unsubscriptions),
        },
      ]
    }),
  }
}

// ── Mailchimp ───────────────────────────────────────────────────────────────

/** Le centre de données est le suffixe de la clé (« -us21 ») : c'est lui qui donne l'adresse de l'API. */
function centreMailchimp(cle: string): string | null {
  const trouve = /-(us\d{1,2})$/u.exec(cle.trim())
  return trouve === null ? null : trouve[1]!
}

function enTetesMailchimp(cle: string): HeadersInit {
  return { authorization: `Basic ${Buffer.from(`evoliia:${cle}`).toString('base64')}`, accept: 'application/json' }
}

export async function verifyMailchimpKey(apiKey: string): Promise<KeyVerdict> {
  const cle = apiKey.trim()
  const centre = centreMailchimp(cle)
  if (!/^[0-9a-f]{32}-us\d{1,2}$/u.test(cle) || centre === null) {
    return { ok: false, reason: 'Une clé API Mailchimp ressemble à « 0123…cdef-us21 » : 32 caractères, un tiret, puis le centre de données.' }
  }
  const ping = await json(`https://${centre}.api.mailchimp.com/3.0/ping`, { headers: enTetesMailchimp(cle) }).catch(() => null)
  if (ping === null) return { ok: false, reason: 'Mailchimp ne répond pas. Réessayez dans un moment.' }
  if (ping.status !== 200) return { ok: false, reason: refus('Mailchimp', ping.status) }
  return { ok: true, label: 'Mailchimp', hint: cle }
}

export async function lireMailchimp(cle: string): Promise<LectureEmailing> {
  const centre = centreMailchimp(cle)
  if (centre === null) return { ok: false, raison: 'La clé Mailchimp enregistrée est illisible. Reconnectez Mailchimp.' }
  const champs = [
    'reports.id',
    'reports.campaign_title',
    'reports.send_time',
    'reports.emails_sent',
    'reports.unsubscribed',
    'reports.opens.unique_opens',
    'reports.clicks.unique_subscriber_clicks',
    'reports.ecommerce',
  ].join(',')
  const reponse = await json(`https://${centre}.api.mailchimp.com/3.0/reports?count=${CAMPAGNES_MAX}&fields=${champs}`, { headers: enTetesMailchimp(cle) })
  if (reponse.status !== 200) return { ok: false, raison: refus('Mailchimp', reponse.status) }
  const rapports = (reponse.corps?.reports ?? []) as {
    id: string
    campaign_title?: string
    send_time?: string
    emails_sent?: number
    unsubscribed?: number
    opens?: { unique_opens?: number }
    clicks?: { unique_subscriber_clicks?: number }
    ecommerce?: { total_orders?: number; total_revenue?: number }
  }[]
  return {
    ok: true,
    campagnes: rapports.flatMap((rapport) => {
      const envoyes = entier(rapport.emails_sent) ?? 0
      if (envoyes === 0) return []
      // Sans boutique reliée à Mailchimp, le bloc e-commerce est absent : inconnu, pas zéro.
      const ecommerce = rapport.ecommerce
      return [
        {
          ref: rapport.id,
          nom: rapport.campaign_title ?? 'Campagne Mailchimp',
          envoyeLe: rapport.send_time?.slice(0, 10) ?? null,
          envoyes,
          ouvertures: entier(rapport.opens?.unique_opens),
          clics: entier(rapport.clicks?.unique_subscriber_clicks),
          conversions: ecommerce === undefined ? null : entier(ecommerce.total_orders),
          caCents: ecommerce === undefined ? null : centimes(ecommerce.total_revenue),
          desinscriptions: entier(rapport.unsubscribed),
        },
      ]
    }),
  }
}

export const OUTILS_EMAILING = ['klaviyo', 'brevo', 'mailchimp'] as const
export type OutilEmailing = (typeof OUTILS_EMAILING)[number]

export const NOM_OUTIL: Record<OutilEmailing, string> = { klaviyo: 'Klaviyo', brevo: 'Brevo', mailchimp: 'Mailchimp' }

export function lireOutil(outil: OutilEmailing, cle: string): Promise<LectureEmailing> {
  return outil === 'klaviyo' ? lireKlaviyo(cle) : outil === 'brevo' ? lireBrevo(cle) : lireMailchimp(cle)
}
