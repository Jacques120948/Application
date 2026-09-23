import { env } from '@/lib/env'
import { logger } from '@/server/observability/logger'
import { adresseDeRetour, echangerCode, estConfigure, rafraichir } from './google-search-console'

/**
 * Google Analytics 4, en lecture seule.
 *
 * Même application Google que Search Console, même adresse de retour, même échange de
 * jetons : seule la portée change. Une seconde application aurait demandé une seconde
 * déclaration chez Google, une seconde vérification, un second secret à garder — pour
 * appeler le même point d'échange.
 *
 * **Une portée, en lecture.** `analytics.readonly` ne permet ni de créer un événement, ni de
 * modifier une propriété, ni d'ajouter un utilisateur. C'est ce que Google affiche sur son
 * écran de consentement.
 *
 * **Des totaux, jamais des visiteurs.** Les rapports demandés ici sont agrégés par jour,
 * canal, appareil et page. Aucun identifiant de visiteur n'est demandé, et l'API de rapports
 * n'en donne d'ailleurs pas.
 *
 * **Gratuit.** L'API de données Analytics est sans frais ; Google la borne par des quotas
 * comptés par propriété — celle de la personne. Evoliia ne paie rien, quel que soit le nombre
 * de comptes reliés.
 */

export { estConfigure, echangerCode, rafraichir }

const AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth'
const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta'
const DONNEES = 'https://analyticsdata.googleapis.com/v1beta'

export const PORTEES = ['https://www.googleapis.com/auth/analytics.readonly'] as const

export function urlAutorisation(etat: string): string {
  const parametres = new URLSearchParams({
    client_id: env.googleClientId ?? '',
    redirect_uri: adresseDeRetour(),
    response_type: 'code',
    scope: PORTEES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: etat,
  })
  return `${AUTORISATION}?${parametres.toString()}`
}

type Reponse<T> = { ok: true; donnees: T } | { ok: false; status: number; raison: string }

async function appeler<T>(url: string, accessToken: string, corps?: unknown): Promise<Reponse<T>> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), 25_000)
  let reponse: Response
  try {
    reponse = await fetch(url, {
      method: corps === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      signal: controle.signal,
    })
  } catch {
    return { ok: false, status: 0, raison: 'Google Analytics est momentanément injoignable. Réessayez.' }
  } finally {
    clearTimeout(minuteur)
  }
  const charge = (await reponse.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
  if (reponse.status !== 200 || charge === null) {
    logger.warn('Google Analytics a refusé un appel', { status: reponse.status })
    return { ok: false, status: reponse.status, raison: refus(reponse.status, charge?.error?.message) }
  }
  return { ok: true, donnees: charge }
}

function refus(status: number, detail?: string): string {
  if (status === 401) return 'Google a révoqué cette autorisation. Reconnectez Google Analytics depuis Connexions.'
  if (status === 403) {
    return /has not been used|is disabled|SERVICE_DISABLED/iu.test(detail ?? '')
      ? 'L’API Google Analytics n’est pas activée pour l’application Google d’Evoliia. L’équipe Evoliia doit l’activer.'
      : 'Ce compte Google n’a pas accès à cette propriété Analytics.'
  }
  if (status === 429) return 'Google Analytics limite les demandes en ce moment. Réessayez plus tard.'
  return detail === undefined || detail === '' ? 'Google Analytics n’a pas répondu comme attendu.' : `Google répond : ${detail.slice(0, 150)}`
}

export type ProprieteGa4 = { id: string; nom: string; compte: string }

/** Les propriétés GA4 que ce compte peut lire. `id` est de la forme « properties/123 ». */
export async function listerProprietes(
  accessToken: string,
): Promise<{ ok: true; proprietes: ProprieteGa4[] } | { ok: false; raison: string }> {
  const reponse = await appeler<{
    accountSummaries?: { displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[]
  }>(`${ADMIN}/accountSummaries?pageSize=200`, accessToken)
  if (!reponse.ok) return { ok: false, raison: reponse.raison }
  const proprietes = (reponse.donnees.accountSummaries ?? []).flatMap((compte) =>
    (compte.propertySummaries ?? [])
      .filter((propriete) => typeof propriete.property === 'string' && /^properties\/\d+$/u.test(propriete.property))
      .map((propriete) => ({ id: propriete.property!, nom: propriete.displayName ?? propriete.property!, compte: compte.displayName ?? '' })),
  )
  return { ok: true, proprietes }
}

/** Le fuseau et la devise de la propriété : c'est son fuseau qui découpe les jours de GA4. */
export async function lireReglagesPropriete(
  accessToken: string,
  propriete: string,
): Promise<{ fuseau: string; devise: string } | null> {
  if (!/^properties\/\d+$/u.test(propriete)) return null
  const reponse = await appeler<{ timeZone?: string; currencyCode?: string }>(`${ADMIN}/${propriete}`, accessToken)
  return reponse.ok ? { fuseau: reponse.donnees.timeZone ?? '', devise: reponse.donnees.currencyCode ?? '' } : null
}

export type LigneRapport = { dimensions: string[]; metriques: number[] }

/**
 * Un rapport agrégé. Les dimensions et métriques viennent du code, jamais de l'extérieur ;
 * la propriété est vérifiée avant d'entrer dans l'adresse.
 */
export async function rapport(
  accessToken: string,
  propriete: string,
  demande: { du: string; au: string; dimensions: string[]; metriques: string[]; filtreCanal?: string; limite?: number },
): Promise<{ ok: true; lignes: LigneRapport[] } | { ok: false; raison: string }> {
  if (!/^properties\/\d+$/u.test(propriete)) return { ok: false, raison: 'Propriété Analytics illisible.' }
  const reponse = await appeler<{
    rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[]
  }>(`${DONNEES}/${propriete}:runReport`, accessToken, {
    dateRanges: [{ startDate: demande.du, endDate: demande.au }],
    dimensions: demande.dimensions.map((name) => ({ name })),
    metrics: demande.metriques.map((name) => ({ name })),
    limit: demande.limite ?? 50_000,
    ...(demande.filtreCanal === undefined
      ? {}
      : {
          dimensionFilter: {
            filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: demande.filtreCanal } },
          },
        }),
  })
  if (!reponse.ok) return { ok: false, raison: reponse.raison }
  return {
    ok: true,
    lignes: (reponse.donnees.rows ?? []).map((ligne) => ({
      dimensions: (ligne.dimensionValues ?? []).map((valeur) => valeur.value ?? ''),
      metriques: (ligne.metricValues ?? []).map((valeur) => {
        const nombre = Number(valeur.value)
        return Number.isFinite(nombre) ? nombre : 0
      }),
    })),
  }
}
