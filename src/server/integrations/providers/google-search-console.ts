import { env } from '@/lib/env'
import { logger } from '@/server/observability/logger'
import { echangerJeton, type Jetons } from '../oauth'

/**
 * Search Console, en lecture seule.
 *
 * C'est la moitié qui manquait au produit. Evoliia mesure un site : ce qu'il contient, ce
 * qu'il déclare, ce qu'une machine peut en reprendre. Elle ne mesure pas la demande — ni ce
 * que les gens tapent, ni où le site sort. Search Console le dit, et c'est la seule source
 * qui le dise sans estimation : ce sont les chiffres de Google sur les propres pages de la
 * personne.
 *
 * Quatre décisions.
 *
 * **Lecture seule, et la portée le dit.** `webmasters.readonly` ne permet aucune écriture :
 * ni soumettre une page, ni demander une réindexation, ni modifier un réglage. La portée
 * demandée est ce que la personne lit sur l'écran de consentement de Google, et elle doit
 * pouvoir la croire.
 *
 * **Le jeton se rafraîchit, il ne se redemande pas.** Un jeton d'accès Google vaut une
 * heure. Sans jeton de rafraîchissement, la personne devrait réautoriser chaque matin —
 * d'où `access_type=offline` et `prompt=consent`, sans lesquels Google ne délivre pas de
 * jeton durable à la deuxième autorisation.
 *
 * **Le coût pour Evoliia est nul.** L'API est gratuite, avec un quota par compte Google, et
 * c'est le compte de la personne qui est appelé — pas celui d'Evoliia. Mille utilisateurs
 * n'y changent rien.
 *
 * **Rien de ce qui est secret n'entre dans le journal.** Ni code, ni jeton, ni identifiant
 * d'application. Un journal se relit, se copie et s'exporte.
 */

const AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth'
const JETON = 'https://oauth2.googleapis.com/token'
const API = 'https://searchconsole.googleapis.com/webmasters/v3'

/*
 * L'inspection d'URL vit sur une autre version de l'API que le reste, et c'est Google qui
 * en a décidé ainsi : `webmasters/v3` pour les chiffres, `v1` pour l'inspection. Deux bases,
 * donc, plutôt qu'un chemin bricolé à partir de l'autre.
 */
const API_INSPECTION = 'https://searchconsole.googleapis.com/v1'

/** Lire, et rien d'autre. C'est ce que Google affichera à la personne. */
export const PORTEES = ['https://www.googleapis.com/auth/webmasters.readonly'] as const

/** Le chemin de retour, déclaré à l'identique dans la console Google. */
export function adresseDeRetour(): string {
  return `${env.appUrl.replace(/\/$/, '')}/api/connexions/google/retour`
}

export function estConfigure(): boolean {
  return env.googleClientId !== undefined && env.googleClientSecret !== undefined
}

/**
 * L'adresse où envoyer la personne pour qu'elle autorise.
 *
 * `access_type=offline` demande un jeton durable ; `prompt=consent` force l'écran de
 * consentement, faute de quoi Google ne redonne pas de jeton de rafraîchissement à
 * quelqu'un qui a déjà autorisé — et la connexion marcherait une heure avant de mourir.
 */
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

export async function echangerCode(
  code: string,
): Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }> {
  return echangerJeton(JETON, {
    code,
    client_id: env.googleClientId ?? '',
    client_secret: env.googleClientSecret ?? '',
    redirect_uri: adresseDeRetour(),
    grant_type: 'authorization_code',
  })
}

export async function rafraichir(
  refreshToken: string,
): Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }> {
  return echangerJeton(JETON, {
    refresh_token: refreshToken,
    client_id: env.googleClientId ?? '',
    client_secret: env.googleClientSecret ?? '',
    grant_type: 'refresh_token',
  })
}

async function appeler<T>(
  chemin: string,
  accessToken: string,
  corps?: unknown,
): Promise<{ ok: true; donnees: T } | { ok: false; status: number; raison: string }> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), 20_000)

  let reponse: Response
  try {
    reponse = await fetch(`${API}${chemin}`, {
      method: corps === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      signal: controle.signal,
    })
  } catch {
    return { ok: false, status: 0, raison: 'Google est momentanément injoignable. Réessayez.' }
  } finally {
    clearTimeout(minuteur)
  }

  const charge = (await reponse.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null

  if (reponse.status !== 200 || charge === null) {
    logger.warn('Search Console a refusé un appel', { status: reponse.status })
    return { ok: false, status: reponse.status, raison: refus(reponse.status, charge?.error?.message) }
  }
  return { ok: true, donnees: charge }
}

function refus(status: number, detail?: string): string {
  if (status === 401) {
    return 'Google a révoqué cette autorisation. Reconnectez Search Console depuis Connexions.'
  }
  if (status === 403) {
    return 'Ce compte Google n’a pas accès à cette propriété Search Console. Vérifiez que vous en êtes bien propriétaire.'
  }
  if (status === 429) {
    return 'Google limite les demandes en ce moment. Réessayez dans quelques minutes.'
  }
  return detail === undefined || detail === ''
    ? 'Google n’a pas répondu comme attendu. Réessayez.'
    : `Google répond : ${detail.slice(0, 150)}`
}

export type Propriete = { siteUrl: string; permission: string }

/** Les propriétés que ce compte Google peut lire. */
export async function listerProprietes(
  accessToken: string,
): Promise<{ ok: true; proprietes: Propriete[] } | { ok: false; raison: string }> {
  const reponse = await appeler<{ siteEntry?: { siteUrl?: string; permissionLevel?: string }[] }>(
    '/sites',
    accessToken,
  )
  if (!reponse.ok) return { ok: false, raison: reponse.raison }

  const proprietes = (reponse.donnees.siteEntry ?? [])
    .filter((entree) => typeof entree.siteUrl === 'string')
    .map((entree) => ({
      siteUrl: entree.siteUrl as string,
      permission: entree.permissionLevel ?? '',
    }))
    // Une propriété qu'on ne peut que voir sans données ne sert à rien ici.
    .filter((propriete) => propriete.permission !== 'siteUnverifiedUser')

  return { ok: true, proprietes }
}

/**
 * Ce que Google sait d'une adresse : indexée ou non, et pourquoi.
 *
 * Rendue telle quelle, sans interprétation, y compris en cas de refus. C'est volontaire :
 * cette fonction sert d'abord à savoir ce que l'API accepte réellement — quelle portée elle
 * exige, quel quota elle applique — et une réponse reformulée ne l'apprendrait à personne.
 *
 * La documentation de Google n'est pas joignable depuis l'atelier. Plutôt que d'affirmer de
 * mémoire ce que cet appel demande et ce qu'il rend, on le lui demande.
 */
export async function inspecterUrl(
  accessToken: string,
  siteUrl: string,
  url: string,
): Promise<{ status: number; corps: unknown }> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), 20_000)

  try {
    const reponse = await fetch(`${API_INSPECTION}/urlInspection/index:inspect`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ inspectionUrl: url, siteUrl, languageCode: 'fr' }),
      signal: controle.signal,
    })
    return { status: reponse.status, corps: await reponse.json().catch(() => null) }
  } catch (erreur) {
    return { status: 0, corps: { erreur: String(erreur).slice(0, 300) } }
  } finally {
    clearTimeout(minuteur)
  }
}

export type Ligne = {
  /** La requête tapée, ou l'adresse de la page, selon ce qui a été demandé. */
  cle: string
  clics: number
  impressions: number
  /** Position moyenne. Plus petit vaut mieux : 1 est le premier résultat. */
  position: number
}

/**
 * Les requêtes avec la page que Google leur associe.
 *
 * Deux dimensions à la fois, ce que l'appel ordinaire ne fait pas. Cela sert à une chose :
 * savoir dans quelle langue Google vous classe pour une requête donnée. Un site multilingue
 * a des chemins par langue, et c'est Google qui dit lequel il retient — pas un dictionnaire
 * qui devinerait la langue de deux mots.
 *
 * Le croisement multiplie les lignes : à nombre de lignes égal, on couvre moins de requêtes
 * que la lecture simple. C'est pourquoi il ne sert que de table d'appoint, jamais de source
 * du classement.
 */
export async function requetesEtPages(
  accessToken: string,
  siteUrl: string,
  jours: number,
): Promise<{ ok: true; lignes: { cle: string; page: string }[] } | { ok: false; raison: string }> {
  const fin = new Date()
  const debut = new Date(fin.getTime() - jours * 24 * 60 * 60 * 1000)
  const jour = (date: Date): string => date.toISOString().slice(0, 10)

  const reponse = await appeler<{ rows?: { keys?: string[] }[] }>(
    `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    accessToken,
    {
      startDate: jour(debut),
      endDate: jour(fin),
      dimensions: ['query', 'page'],
      rowLimit: LIGNES_MAX,
    },
  )
  if (!reponse.ok) return { ok: false, raison: reponse.raison }

  const lignes = (reponse.donnees.rows ?? [])
    .map((ligne) => ({ cle: ligne.keys?.[0] ?? '', page: ligne.keys?.[1] ?? '' }))
    .filter((ligne) => ligne.cle !== '' && ligne.page !== '')

  return { ok: true, lignes }
}

/** Ce qu'on demande au plus. Au-delà, l'écran ne se lit plus et l'appel s'alourdit. */
export const LIGNES_MAX = 100

/**
 * Les chiffres de recherche d'une propriété.
 *
 * `dimension` vaut `query` pour ce que les gens tapent, `page` pour les adresses qui
 * sortent, `country` pour l'origine des affichages. Tout se lit sur la même période, ce qui
 * permet de rapprocher les trois.
 *
 * `pays` restreint la lecture à un seul pays, par son code ISO à trois lettres. Sans lui,
 * les chiffres mélangent tous les marchés — et une page très affichée depuis un pays qu'on
 * ne sert pas ressemble alors exactement à une occasion manquée, ce qu'elle n'est pas.
 */
export async function requetes(
  accessToken: string,
  siteUrl: string,
  dimension: 'query' | 'page' | 'country',
  jours: number,
  pays?: string,
): Promise<{ ok: true; lignes: Ligne[] } | { ok: false; raison: string }> {
  const fin = new Date()
  const debut = new Date(fin.getTime() - jours * 24 * 60 * 60 * 1000)
  const jour = (date: Date): string => date.toISOString().slice(0, 10)

  /*
   * Le code est réécrit ici plutôt que cru sur parole : il vient d'un paramètre d'adresse.
   * Trois lettres minuscules, rien d'autre, et tout le reste vaut « aucun filtre » — une
   * valeur inattendue rend alors les chiffres de tout le monde, jamais une erreur de Google
   * sur un écran qu'on venait seulement consulter.
   */
  const cible = pays !== undefined && /^[a-z]{3}$/i.test(pays) ? pays.toLowerCase() : undefined

  const reponse = await appeler<{
    rows?: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[]
  }>(`/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, accessToken, {
    startDate: jour(debut),
    endDate: jour(fin),
    dimensions: [dimension],
    rowLimit: LIGNES_MAX,
    ...(cible === undefined
      ? {}
      : {
          dimensionFilterGroups: [
            { filters: [{ dimension: 'country', operator: 'equals', expression: cible }] },
          ],
        }),
  })
  if (!reponse.ok) return { ok: false, raison: reponse.raison }

  const lignes = (reponse.donnees.rows ?? [])
    .map((ligne) => ({
      cle: ligne.keys?.[0] ?? '',
      clics: Math.round(ligne.clicks ?? 0),
      impressions: Math.round(ligne.impressions ?? 0),
      position: Number((ligne.position ?? 0).toFixed(1)),
    }))
    .filter((ligne) => ligne.cle !== '')

  return { ok: true, lignes }
}
