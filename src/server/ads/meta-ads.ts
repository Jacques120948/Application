import { env } from '@/lib/env'
import type { Jetons } from '@/server/integrations/oauth'
import { logger } from '@/server/observability/logger'
import type { AccesAds, AdPlatformAuth, CompteAds, Lecture } from './provider'

/**
 * Meta Ads, en lecture — Facebook et Instagram.
 *
 * Trois choses séparent cette intégration de Google Ads, et chacune a une conséquence ici.
 *
 * **Meta ne délivre pas de jeton de rafraîchissement.** Toute la mécanique OAuth du produit
 * repose sur le couple jeton court / jeton de rafraîchissement, et Meta n'en a pas : il
 * délivre un jeton de deux heures, qu'on échange une fois contre un jeton de soixante jours,
 * lequel s'échange à son tour contre un autre de soixante jours — tant qu'il est encore
 * valide. Passé la date, il n'y a plus rien à échanger et la personne doit reconnecter.
 *
 * D'où le renouvellement **par anticipation**, décrit plus bas : la date d'expiration
 * enregistrée est volontairement antérieure à la vraie. C'est le seul endroit du produit où
 * une date en base ment sciemment, et il fallait que ce soit écrit.
 *
 * **La version d'API vit dans l'environnement.** Google a appris cette leçon à ce dépôt : sa
 * version est une constante du code, et le jour où elle s'éteindra il faudra un déploiement
 * pour la relever. Meta en retire une tous les deux ans environ. Ici, la relever est une
 * variable.
 *
 * **La portée `ads_management` ouvre l'écriture**, et Meta n'en publie pas de version
 * intermédiaire. Comme pour Google, la garantie ne vient donc pas de la plateforme mais
 * d'ici : ce fichier ne contient aucune fonction d'écriture. Le connecteur d'écriture, le
 * jour où il existera, vivra dans un fichier séparé — c'est ce qui rend la garantie
 * vérifiable autrement que sur parole.
 */

const GRAPH = 'https://graph.facebook.com'
const DIALOGUE = 'https://www.facebook.com'

/**
 * Les portées demandées, et celle qu'on ne demande pas.
 *
 * `ads_read` pour lire, `ads_management` pour modifier après confirmation. Meta ne propose
 * rien entre les deux.
 *
 * `business_management` est délibérément absente. Elle sert à parcourir les Business
 * Manager eux-mêmes, ce qu'Evoliia ne fait pas : `/me/adaccounts` rend déjà les comptes
 * qu'une personne atteint à travers son entreprise, du moment qu'elle y a un rôle. La
 * demander aurait alourdi la revue d'application de Meta pour une donnée dont personne ne se
 * sert — et le catalogue pose comme principe de n'en demander aucune de plus.
 */
export const PORTEES = ['ads_read', 'ads_management'] as const

const DELAI_MS = 30_000

/**
 * La marge prise sur l'expiration réelle d'un jeton.
 *
 * Sept jours, et c'est la pièce qui fait tenir l'ensemble. La couche d'intégrations ne
 * renouvelle qu'après la date enregistrée ; si cette date était la vraie, le renouvellement
 * partirait avec un jeton déjà mort et Meta le refuserait — la connexion tomberait à chaque
 * fois, sans autre remède que de reconnecter à la main tous les deux mois.
 *
 * En enregistrant une date antérieure de sept jours, le renouvellement part avec un jeton
 * encore valide, Meta le remplace, et la personne ne voit jamais rien. Sept jours laissent
 * la place à un site qu'on n'ouvre pas pendant une semaine.
 */
export const MARGE_MS = 7 * 24 * 60 * 60 * 1000

/** Ce que Meta rend pour un jeton longue durée quand il ne dit pas la durée : soixante jours. */
const DUREE_DEFAUT_MS = 60 * 24 * 60 * 60 * 1000

export function estConfigureMeta(): boolean {
  return env.metaAppId !== undefined && env.metaAppSecret !== undefined
}

function version(): string {
  return env.metaApiVersion
}

function adresseRetour(): string {
  return `${env.appUrl}/api/connexions/meta/retour`
}

/**
 * L'adresse du dialogue d'autorisation, dans l'une des deux formes que Meta accepte.
 *
 * **Avec une configuration** — le cas de toute application créée aujourd'hui à partir du cas
 * d'usage « API Marketing ». Les portées ne voyagent plus dans l'adresse : elles vivent dans
 * la configuration, et la personne y choisit en plus les comptes publicitaires qu'elle
 * confie. C'est un progrès réel pour elle : elle peut en accorder deux sur cinq, là où la
 * forme classique ouvrait tout ce à quoi elle a droit.
 *
 * **Sans configuration** — la forme classique, portées dans l'adresse. Conservée parce
 * qu'elle reste valable pour les applications plus anciennes, et parce qu'une intégration
 * qui ne marche que sur les installations neuves est une intégration qui casse en silence
 * chez ceux qui l'avaient déjà.
 *
 * `scope` et `config_id` ne cohabitent pas : envoyer les deux fait refuser le dialogue par
 * Meta, avec un message qui ne dit pas lequel est de trop.
 */
function urlAutorisation(etat: string): string {
  const configuration = env.metaLoginConfigId
  const parametres = new URLSearchParams({
    client_id: env.metaAppId ?? '',
    redirect_uri: adresseRetour(),
    response_type: 'code',
    state: etat,
    ...(configuration === undefined || configuration === ''
      ? /* Meta sépare ses portées par des virgules là où Google emploie des espaces. */
        { scope: PORTEES.join(',') }
      : { config_id: configuration }),
  })
  return `${DIALOGUE}/${version()}/dialog/oauth?${parametres.toString()}`
}

export type ReponseMeta = {
  access_token?: unknown
  expires_in?: unknown
  error?: { message?: unknown; type?: unknown; code?: unknown }
}

/**
 * Ce que Meta refuse, dit à quelqu'un qui peut y faire quelque chose.
 *
 * Sa phrase d'abord traduite en geste, puis citée. Même discipline que pour Google, et pour
 * la même raison : derrière un seul code d'erreur, Meta écrit des choses qui n'appellent pas
 * du tout la même action, et conseiller sans dire pourquoi envoie vérifier ce qui marchait
 * déjà.
 *
 * Rien de ce qui passe ici ne porte de secret : ce sont les messages d'erreur de Meta, pas
 * la requête qui les a provoqués.
 */
export function messageRefusMeta(status: number, erreur: ReponseMeta['error']): string {
  const message = typeof erreur?.message === 'string' ? erreur.message : ''
  const code = typeof erreur?.code === 'number' ? erreur.code : 0
  const dit = message === '' ? '' : ` Meta précise : ${message.slice(0, 250)}`

  /*
   * 190 : jeton invalide ou révoqué. C'est le cas le plus fréquent et le seul dont le
   * remède soit entièrement entre les mains de la personne — un mot de passe changé, une
   * application retirée, ou simplement soixante jours sans ouvrir Evoliia.
   */
  if (code === 190 || status === 401) {
    return `Evoliia n’a plus accès à votre compte Meta. Reconnectez-le depuis Connexions.${dit}`
  }
  if (code === 200 || code === 10 || status === 403) {
    return `Votre compte Meta n’autorise pas cette lecture. Vérifiez que vous avez bien un rôle sur ce compte publicitaire.${dit}`
  }
  /* 4, 17, 32, 613 : les différentes façons dont Meta dit « trop d'appels ». */
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) {
    return `Meta limite temporairement les appels d’Evoliia. Réessayez dans un moment.${dit}`
  }
  if (status >= 500) {
    return `Meta est momentanément indisponible. Réessayez dans un moment.${dit}`
  }
  return message === ''
    ? `Meta a refusé la demande (code ${status}).`
    : `Meta a refusé la demande.${dit}`
}

/**
 * Un appel à l'API Graph, en GET.
 *
 * Meta attend ses paramètres dans l'adresse, y compris pour l'échange de jeton — c'est une
 * différence avec la norme OAuth, où l'échange se fait en POST. Employer le POST ici
 * fonctionne parfois et échoue selon la version : suivre la documentation de Meta plutôt que
 * l'habitude évite un refus qu'on chercherait ailleurs.
 *
 * Le jeton voyage donc dans l'adresse. Il n'entre dans aucun journal : ce module ne
 * journalise jamais l'adresse appelée, seulement le chemin.
 */
async function appeler<T>(
  chemin: string,
  parametres: Record<string, string>,
): Promise<{ ok: true; donnees: T } | { ok: false; raison: string }> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)

  let reponse: Response
  try {
    reponse = await fetch(
      `${GRAPH}/${version()}${chemin}?${new URLSearchParams(parametres).toString()}`,
      { headers: { accept: 'application/json' }, signal: controle.signal },
    )
  } catch {
    return { ok: false, raison: 'Meta est momentanément injoignable. Réessayez.' }
  } finally {
    clearTimeout(minuteur)
  }

  const corps = (await reponse.json().catch(() => null)) as (ReponseMeta & T) | null
  if (reponse.status !== 200 || corps === null) {
    /* Le chemin, jamais l'adresse complète : elle porterait le jeton. */
    logger.warn('Meta a refusé un appel', { chemin, status: reponse.status })
    return { ok: false, raison: messageRefusMeta(reponse.status, corps?.error) }
  }
  return { ok: true, donnees: corps }
}

/** Traduit une réponse de jeton de Meta, avec la marge de renouvellement. */
export function jetonsDepuisMeta(
  corps: ReponseMeta,
): { ok: true; jetons: Jetons } | { ok: false; raison: string } {
  const acces = typeof corps.access_token === 'string' ? corps.access_token : ''
  if (acces === '') {
    return { ok: false, raison: 'Meta n’a pas délivré de jeton. Reprenez la connexion.' }
  }

  /*
   * `expires_in` est en secondes. Meta l'omet pour les jetons qu'il déclare sans expiration,
   * ce qui n'est vrai que sur le papier : ils sont révoqués dès qu'un mot de passe change.
   * Les traiter comme des soixante jours ordinaires garde le renouvellement en marche plutôt
   * que de faire confiance à une promesse que Meta ne tient pas toujours.
   */
  const duree =
    typeof corps.expires_in === 'number' && corps.expires_in > 0
      ? corps.expires_in * 1000
      : DUREE_DEFAUT_MS

  /*
   * La date enregistrée est antérieure à la vraie, délibérément. Voir MARGE_MS : c'est ce
   * qui fait partir le renouvellement pendant que le jeton est encore échangeable. Le
   * plancher à une minute existe pour le cas limite d'un jeton plus court que la marge —
   * l'échange partira aussitôt, ce qui est exactement ce qu'on veut.
   */
  const fin = Date.now() + Math.max(60_000, duree - MARGE_MS)

  return {
    ok: true,
    jetons: {
      accessToken: acces,
      /*
       * Le même jeton des deux côtés, et ce n'est pas une négligence. Meta n'a pas de jeton
       * de rafraîchissement : c'est le jeton longue durée lui-même qu'on représente pour en
       * obtenir un neuf. Les deux colonnes portent donc la même valeur, et restent
       * synchronisées parce que chaque renouvellement les réécrit toutes les deux.
       */
      refreshToken: acces,
      expiresAt: new Date(fin),
    },
  }
}

/**
 * Au-delà, le jeton rendu à l'échange est déjà durable et n'a pas à être rééchangé.
 *
 * Sept jours : bien au-dessus des deux heures d'un jeton court, bien en dessous des soixante
 * jours d'un jeton long. Aucune des deux formes ne peut tomber du mauvais côté.
 */
const DUREE_DURABLE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Échange le code de retour contre un jeton durable.
 *
 * Un appel, parfois deux, et c'est Meta qui décide. La connexion classique rend un jeton de
 * deux heures : s'en contenter donnerait une connexion qui marche pendant la démonstration
 * et tombe le soir même, sans que rien n'explique pourquoi. Login for Business, lui, rend
 * directement un jeton de soixante jours.
 *
 * On regarde donc la durée rendue plutôt que de supposer la forme. Rééchanger un jeton déjà
 * durable fonctionne le plus souvent, mais « le plus souvent » n'est pas une garantie qu'on
 * veut poser sur le chemin d'une première connexion — celui qu'on ne voit échouer qu'une
 * fois, chez quelqu'un, sans pouvoir le reproduire.
 */
async function echangerCode(
  code: string,
): Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }> {
  const premier = await appeler<ReponseMeta>('/oauth/access_token', {
    client_id: env.metaAppId ?? '',
    client_secret: env.metaAppSecret ?? '',
    redirect_uri: adresseRetour(),
    code,
  })
  if (!premier.ok) return premier

  const jeton = typeof premier.donnees.access_token === 'string' ? premier.donnees.access_token : ''
  if (jeton === '') {
    return { ok: false, raison: 'Meta n’a pas délivré de jeton. Reprenez la connexion.' }
  }

  const duree =
    typeof premier.donnees.expires_in === 'number' ? premier.donnees.expires_in * 1000 : 0
  if (duree >= DUREE_DURABLE_MS) return jetonsDepuisMeta(premier.donnees)

  return rafraichir(jeton)
}

/**
 * Obtient un jeton neuf de soixante jours à partir de celui qu'on a.
 *
 * Le même appel sert à transformer un jeton court en jeton long et à prolonger un jeton long :
 * chez Meta, c'est la même opération. C'est pourquoi `echangerCode` se termine ici.
 *
 * Il échoue si le jeton présenté est déjà expiré, et c'est irrattrapable — il n'y a alors
 * plus rien à échanger. C'est tout l'objet de la marge de sept jours.
 */
async function rafraichir(
  jeton: string,
): Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }> {
  const long = await appeler<ReponseMeta>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: env.metaAppId ?? '',
    client_secret: env.metaAppSecret ?? '',
    fb_exchange_token: jeton,
  })
  if (!long.ok) return long
  return jetonsDepuisMeta(long.donnees)
}

type CompteMeta = {
  account_id?: unknown
  name?: unknown
  currency?: unknown
  timezone_name?: unknown
  account_status?: unknown
}

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : ''
}

/**
 * Les comptes publicitaires que cette autorisation atteint.
 *
 * Meta n'a pas de compte administrateur au sens de Google : un Business Manager détient des
 * comptes, il n'en est pas un lui-même, et tous ceux que rend cette liste diffusent de la
 * publicité. `gestionnaire` est donc toujours faux — et c'est une information, pas un
 * remplissage : elle signifie qu'aucun compte n'est à écarter d'office du choix.
 *
 * La devise vide signale, dans tout le produit, un compte qu'on n'a pas pu lire. Meta la
 * rend pour tout compte auquel on a accès, y compris fermé : un compte sans devise ici est
 * donc bien un compte illisible, et la couche des comptes le refusera comme pour Google.
 */
async function listerComptes(accessToken: string): Promise<Lecture<CompteAds[]>> {
  const lecture = await appeler<{ data?: CompteMeta[] }>('/me/adaccounts', {
    access_token: accessToken,
    fields: 'account_id,name,currency,timezone_name,account_status',
    /* Cent comptes couvrent toutes les agences que ce produit rencontrera. */
    limit: '100',
  })
  if (!lecture.ok) return { ok: false, raison: lecture.raison }

  const comptes = (lecture.donnees.data ?? [])
    .map((brut) => ({
      compteId: texte(brut.account_id),
      nom: texte(brut.name),
      devise: texte(brut.currency),
      fuseau: texte(brut.timezone_name),
      gestionnaire: false,
    }))
    .filter((compte) => compte.compteId !== '')

  logger.info('comptes Meta lus', { nombre: comptes.length })
  return { ok: true, valeur: comptes }
}

export const metaAds: AdPlatformAuth = {
  id: 'meta-ads',
  nom: 'Meta Ads',
  estConfigure: estConfigureMeta,
  urlAutorisation,
  echangerCode,
  rafraichir,
  listerComptes,
}

// ════════════════════════ La lecture des campagnes ═══════════════════════════

/**
 * Le nombre de pages qu'on suit au plus.
 *
 * Meta pagine tout, et sa page suivante est une adresse complète qu'il suffit de rappeler.
 * Une boucle sans borne dépend donc entièrement de ce que Meta décide de rendre : un compte
 * d'agence, un curseur qui se répète, et la lecture nocturne d'un seul compte consomme le
 * plafond de tout le monde. Vingt pages couvrent très largement les comptes que ce produit
 * rencontrera, et la borne est dite plutôt que subie.
 */
const PAGES_MAX = 20

type Page<T> = { data?: T[]; paging?: { next?: unknown } }

/**
 * Un appel paginé, suivi jusqu'au bout.
 *
 * L'adresse de la page suivante porte le jeton : elle est rappelée telle quelle, et n'entre
 * dans aucun journal.
 */
async function appelerTout<T>(
  chemin: string,
  parametres: Record<string, string>,
): Promise<{ ok: true; lignes: T[] } | { ok: false; raison: string }> {
  const lignes: T[] = []
  let premier = await appeler<Page<T>>(chemin, parametres)
  if (!premier.ok) return premier
  lignes.push(...(premier.donnees.data ?? []))

  let suivante = typeof premier.donnees.paging?.next === 'string' ? premier.donnees.paging.next : ''
  for (let page = 1; page < PAGES_MAX && suivante !== ''; page += 1) {
    const controle = new AbortController()
    const minuteur = setTimeout(() => controle.abort(), DELAI_MS)
    let reponse: Response
    try {
      reponse = await fetch(suivante, { headers: { accept: 'application/json' }, signal: controle.signal })
    } catch {
      return { ok: false, raison: 'Meta est momentanément injoignable. Réessayez.' }
    } finally {
      clearTimeout(minuteur)
    }
    const corps = (await reponse.json().catch(() => null)) as (ReponseMeta & Page<T>) | null
    if (reponse.status !== 200 || corps === null) {
      logger.warn('Meta a refusé une page', { chemin, status: reponse.status })
      return { ok: false, raison: messageRefusMeta(reponse.status, corps?.error) }
    }
    lignes.push(...(corps.data ?? []))
    suivante = typeof corps.paging?.next === 'string' ? corps.paging.next : ''
  }

  return { ok: true, lignes }
}

/**
 * Ce qu'on refuse de lire : l'archivé et le supprimé.
 *
 * Un compte qui tourne depuis des années accumule des campagnes mortes — cent quatorze sur
 * le premier compte réel qui a essayé, dont une poignée seulement diffusaient encore. Les
 * lire toutes coûte des pages chez Meta, des écritures en base, et remplit un tableau de
 * bord de lignes sur lesquelles on ne peut rien faire.
 *
 * Exclure plutôt qu'énumérer, et c'est délibéré : la liste des états vivants s'allonge avec
 * le temps chez Meta — `WITH_ISSUES`, `IN_PROCESS`, et ceux qu'il ajoutera. Nommer ce qu'on
 * garde ferait disparaître en silence, un jour, un état qu'on aurait voulu voir. Nommer ce
 * qu'on écarte ne peut échouer que dans l'autre sens : montrer une ligne de trop.
 */
const ECARTES = JSON.stringify([
  { field: 'effective_status', operator: 'NOT_IN', value: ['ARCHIVED', 'DELETED'] },
])

/** `act_` devant le numéro, tel que Meta désigne un compte dans ses adresses. */
function ressource(compteId: string): string {
  return `/act_${compteId.replace(/^act_/u, '')}`
}

/**
 * Un montant rendu par Meta, en micros de la devise du compte.
 *
 * Meta écrit les dépenses en unités entières et décimales — « 12.34 » pour douze francs
 * trente-quatre — là où les budgets sont en centimes entiers. Deux conventions dans la même
 * réponse, et les confondre donne un facteur cent : une campagne à 5 francs par jour
 * s'afficherait à 500, ou l'inverse. D'où deux fonctions plutôt qu'une, nommées d'après ce
 * qu'elles convertissent.
 */
export function depenseEnMicros(valeur: unknown): number {
  const nombre = typeof valeur === 'number' ? valeur : Number.parseFloat(String(valeur ?? ''))
  return Number.isFinite(nombre) && nombre > 0 ? Math.round(nombre * 1_000_000) : 0
}

/** Un budget rendu par Meta : des centimes entiers, jamais des unités. */
export function budgetEnMicros(valeur: unknown): number {
  const centimes = typeof valeur === 'number' ? valeur : Number.parseInt(String(valeur ?? ''), 10)
  return Number.isFinite(centimes) && centimes > 0 ? centimes * 10_000 : 0
}

/**
 * Les types d'action qui comptent comme un achat, par ordre de préférence.
 *
 * L'ordre est tout, et c'est le piège le plus coûteux de cette API. Meta rend une même vente
 * sous plusieurs étiquettes à la fois : `purchase`, `omni_purchase`,
 * `offsite_conversion.fb_pixel_purchase`… Les additionner compterait la même vente deux ou
 * trois fois — un ROAS triplé, parfaitement plausible à l'écran, sur lequel on augmenterait
 * un budget.
 *
 * On en retient donc **une seule**, la première trouvée. `omni_purchase` d'abord : c'est le
 * total dédoublonné de Meta, celui qui réconcilie le site, l'application et la boutique.
 */
const ACHATS = [
  'omni_purchase',
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
] as const

type ActionMeta = { action_type?: unknown; value?: unknown }

/**
 * Le nombre d'achats d'une ligne d'insights, ou sa valeur.
 *
 * Jamais une somme : voir `ACHATS`. Zéro quand aucune étiquette connue n'apparaît, ce qui
 * est un état ordinaire — une campagne de notoriété n'a pas d'achats, et lui en inventer
 * serait pire que de n'en montrer aucun.
 */
export function achatsDe(actions: unknown): number {
  if (!Array.isArray(actions)) return 0
  for (const etiquette of ACHATS) {
    const trouvee = (actions as ActionMeta[]).find((une) => une?.action_type === etiquette)
    if (trouvee === undefined) continue
    const valeur = Number.parseFloat(String(trouvee.value ?? ''))
    return Number.isFinite(valeur) && valeur > 0 ? valeur : 0
  }
  return 0
}

export type CampagneMeta = {
  campagneId: string
  nom: string
  /** L'objectif, tel que Meta le nomme : OUTCOME_SALES, OUTCOME_TRAFFIC… */
  type: string
  statut: string
  /** Le budget quotidien quand la campagne le pilote. 0 : il vit sur les ensembles. */
  budgetMicros: number
}

export type EnsembleMeta = {
  ensembleId: string
  campagneId: string
  nom: string
  statut: string
  /** Le budget quotidien quand il vit à ce niveau. 0 : la campagne le pilote. */
  budgetMicros: number
}

export type AnnonceMeta = {
  annonceId: string
  ensembleId: string
  nom: string
  statut: string
  /** L'adresse de la vignette chez Meta. Jamais l'image : Evoliia n'héberge pas de créatives. */
  apercu: string
}

/** Une journée d'un objet, à l'un des trois niveaux. */
export type JourneeMeta = {
  /** Vide pour les lignes de campagne : voir `niveaux.ts`. */
  ensembleId: string
  annonceId: string
  campagneId: string
  jour: string
  coutMicros: number
  impressions: number
  clics: number
  /** Personnes distinctes atteintes. Meta le donne, Google non. */
  portee: number
  achats: number
  valeurAchats: number
}

function statut(ligne: Record<string, unknown>): string {
  /*
   * `effective_status` plutôt que `status`, et la nuance décide de ce qu'on affiche : une
   * annonce active dans une campagne en pause n'est pas diffusée. `status` dirait ACTIVE,
   * `effective_status` dit CAMPAIGN_PAUSED. Montrer le premier ferait chercher pourquoi une
   * annonce « active » ne dépense rien.
   */
  return texte(ligne.effective_status) || texte(ligne.status)
}

/** Ce que Meta dit avoir réellement accordé, et ce qu'il dit avoir été refusé. */
export type PermissionsMeta = { accordees: string[]; refusees: string[] }

/**
 * Les autorisations réellement obtenues, demandées à Meta plutôt que supposées.
 *
 * Evoliia enregistrait jusqu'ici les portées qu'elle avait **demandées**, ce qui n'est pas
 * la même chose que celles qu'elle a reçues : l'écran de consentement de Meta permet de
 * décocher une permission à la volée. Le dossier affirmait donc un droit d'écriture que le
 * jeton n'avait peut-être pas, et l'on ne l'aurait découvert qu'au premier bouton, sur un
 * refus incompréhensible.
 *
 * `/me/permissions` est la seule source qui sache. L'appel est gratuit, sans paramètre, et
 * ne lit rien du compte publicitaire — il ne dit que ce que cette personne a accordé à cette
 * application.
 */
export async function lirePermissionsMeta(
  accessToken: string,
): Promise<Lecture<PermissionsMeta>> {
  const lecture = await appelerTout<Record<string, unknown>>('/me/permissions', {
    access_token: accessToken,
  })
  if (!lecture.ok) return { ok: false, raison: lecture.raison }

  const accordees: string[] = []
  const refusees: string[] = []
  for (const ligne of lecture.lignes) {
    const nom = texte(ligne.permission)
    if (nom === '') continue
    // Meta ne connaît que deux états : « granted » et « declined ». Tout autre mot est
    // nouveau, donc inconnu, donc pas un accord — on ne devine pas un droit.
    if (texte(ligne.status) === 'granted') accordees.push(nom)
    else refusees.push(nom)
  }

  return { ok: true, valeur: { accordees, refusees } }
}

export async function lireCampagnesMeta(acces: AccesAds): Promise<Lecture<CampagneMeta[]>> {
  const lecture = await appelerTout<Record<string, unknown>>(
    `${ressource(acces.compteId)}/campaigns`,
    {
      access_token: acces.accessToken,
      fields: 'id,name,objective,status,effective_status,daily_budget',
      filtering: ECARTES,
      limit: '200',
    },
  )
  if (!lecture.ok) return { ok: false, raison: lecture.raison }

  return {
    ok: true,
    valeur: lecture.lignes
      .map((ligne) => ({
        campagneId: texte(ligne.id),
        nom: texte(ligne.name),
        type: texte(ligne.objective),
        statut: statut(ligne),
        budgetMicros: budgetEnMicros(ligne.daily_budget),
      }))
      .filter((campagne) => campagne.campagneId !== ''),
  }
}

export async function lireEnsemblesMeta(acces: AccesAds): Promise<Lecture<EnsembleMeta[]>> {
  const lecture = await appelerTout<Record<string, unknown>>(
    `${ressource(acces.compteId)}/adsets`,
    {
      access_token: acces.accessToken,
      fields: 'id,name,campaign_id,status,effective_status,daily_budget',
      filtering: ECARTES,
      limit: '200',
    },
  )
  if (!lecture.ok) return { ok: false, raison: lecture.raison }

  return {
    ok: true,
    valeur: lecture.lignes
      .map((ligne) => ({
        ensembleId: texte(ligne.id),
        campagneId: texte(ligne.campaign_id),
        nom: texte(ligne.name),
        statut: statut(ligne),
        budgetMicros: budgetEnMicros(ligne.daily_budget),
      }))
      .filter((un) => un.ensembleId !== '' && un.campagneId !== ''),
  }
}

export async function lireAnnoncesMeta(acces: AccesAds): Promise<Lecture<AnnonceMeta[]>> {
  const lecture = await appelerTout<Record<string, unknown>>(`${ressource(acces.compteId)}/ads`, {
    access_token: acces.accessToken,
    fields: 'id,name,adset_id,status,effective_status,creative{thumbnail_url}',
    filtering: ECARTES,
    limit: '200',
  })
  if (!lecture.ok) return { ok: false, raison: lecture.raison }

  return {
    ok: true,
    valeur: lecture.lignes
      .map((ligne) => {
        const creatif = (ligne.creative ?? {}) as Record<string, unknown>
        return {
          annonceId: texte(ligne.id),
          ensembleId: texte(ligne.adset_id),
          nom: texte(ligne.name),
          statut: statut(ligne),
          apercu: texte(creatif.thumbnail_url),
        }
      })
      .filter((une) => une.annonceId !== '' && une.ensembleId !== ''),
  }
}

/** Les trois étages auxquels Meta sait rendre des chiffres. */
export type NiveauMeta = 'campaign' | 'adset' | 'ad'

/**
 * Les journées d'un compte, à l'un des trois niveaux.
 *
 * `time_increment=1` demande une ligne par jour : sans lui, Meta rend un seul total pour
 * toute la période, ce qui ne permet ni courbe ni comparaison — et ressemble pourtant à une
 * réponse valable.
 *
 * La fenêtre d'attribution n'est pas imposée : c'est celle du compte qui s'applique, et
 * c'est délibéré. Forcer une fenêtre ici donnerait des chiffres qui ne correspondraient pas
 * à ceux que la personne lit dans son gestionnaire Meta — deux vérités pour la même semaine,
 * et aucune façon de savoir laquelle croire.
 */
export async function lireJourneesMeta(
  acces: AccesAds,
  niveau: NiveauMeta,
  depuis: string,
  jusqua: string,
): Promise<Lecture<JourneeMeta[]>> {
  const lecture = await appelerTout<Record<string, unknown>>(
    `${ressource(acces.compteId)}/insights`,
    {
      access_token: acces.accessToken,
      level: niveau,
      fields:
        'campaign_id,adset_id,ad_id,spend,impressions,clicks,reach,actions,action_values,date_start',
      time_range: JSON.stringify({ since: depuis, until: jusqua }),
      time_increment: '1',
      limit: '500',
    },
  )
  if (!lecture.ok) return { ok: false, raison: lecture.raison }

  return {
    ok: true,
    valeur: lecture.lignes
      .map((ligne) => ({
        campagneId: texte(ligne.campaign_id),
        /*
         * Chaîne vide aux étages supérieurs, et c'est ce qui permet aux trois de cohabiter
         * dans la même table sans que les totaux comptent la même dépense trois fois.
         */
        ensembleId: niveau === 'campaign' ? '' : texte(ligne.adset_id),
        annonceId: niveau === 'ad' ? texte(ligne.ad_id) : '',
        jour: texte(ligne.date_start),
        coutMicros: depenseEnMicros(ligne.spend),
        impressions: Math.round(Number.parseFloat(String(ligne.impressions ?? '0')) || 0),
        clics: Math.round(Number.parseFloat(String(ligne.clicks ?? '0')) || 0),
        portee: Math.round(Number.parseFloat(String(ligne.reach ?? '0')) || 0),
        achats: achatsDe(ligne.actions),
        valeurAchats: achatsDe(ligne.action_values),
      }))
      .filter((une) => une.campagneId !== '' && /^\d{4}-\d{2}-\d{2}$/u.test(une.jour)),
  }
}
