import { env } from '@/lib/env'
import { echangerJeton, type Jetons } from '@/server/integrations/oauth'
import { logger } from '@/server/observability/logger'
import type {
  AccesAds,
  AdPlatformProvider,
  CampagneAds,
  ChampAds,
  AnnonceAds,
  CompteAds,
  ElementAds,
  GroupeAds,
  IdeeMotCle,
  JourneeAds,
  Lecture,
  TermeAds,
  TexteAnnonceAds,
} from './provider'

/**
 * Google Ads, en lecture.
 *
 * Trois choses distinguent cette intégration de Search Console et de Shopify, et chacune a
 * une conséquence dans ce fichier.
 *
 * **Le quota appartient au projet Google Cloud d'Evoliia.** Chaque personne autorise son
 * propre compte par OAuth, mais le niveau d'accès s'attache au projet Cloud qui a délivré le
 * client OAuth — donc à l'exploitant, et le plafond quotidien est partagé par tous les
 * utilisateurs. C'est la seule ressource du produit qui se consomme en commun : d'où les
 * lectures groupées plus bas, et non une requête par campagne.
 *
 * Le jeton développeur, lui, n'existe plus : Google l'a supprimé le 9 septembre 2026 et
 * ignore désormais l'en-tête. Il est encore envoyé quand l'exploitant en possède un — une
 * installation ancienne n'a rien à défaire — mais il n'est plus exigé nulle part.
 *
 * **La portée `adwords` ouvre l'écriture.** Google n'en propose pas de version en lecture
 * seule : demander à lire, c'est obtenir le droit de modifier. On ne peut donc pas compter
 * sur Google pour empêcher une écriture accidentelle — la garantie doit venir d'ici. Ce
 * fichier ne contient aucune fonction d'écriture, et n'en contiendra qu'au moment où le
 * mode assisté sera construit, avec ses confirmations.
 *
 * **Les chiffres du jour sont mouvants.** Google corrige ses conversions pendant plusieurs
 * jours. Une journée lue le matin même n'est pas fausse, elle est provisoire — et c'est
 * pourquoi les journées se réécrivent à chaque lecture plutôt que de s'empiler.
 */

/**
 * La version d'API visée.
 *
 * Elle est nommée ici plutôt que devinée : Google publie une version par trimestre et
 * retire les anciennes. Le jour où celle-ci s'éteint, c'est cette ligne qui change, et un
 * refus nommé vaut mieux qu'un 404 sans explication.
 */
const VERSION = 'v22'

/**
 * Le nombre de mots que le planificateur accepte comme point de départ.
 *
 * Vingt est la limite de Google. La dépasser ne fait pas ignorer les surnuméraires : elle
 * fait refuser l'appel entier, donc perdre aussi les dix-neuf premiers.
 */
const GRAINES_MAX = 20

/**
 * Le nombre de mots-clés dont on demande les chiffres d'un coup.
 *
 * Google en accepte bien davantage. La borne est la nôtre : au-delà, on chiffrerait une
 * traîne de requêtes vues une fois, qui n'apprennent rien et consomment le quota partagé.
 */
const MOTS_CLES_CHIFFRES = 60

/*
 * Exportées pour le connecteur d'écriture, qui vit dans un fichier séparé. La séparation
 * n'est pas cosmétique : ce fichier-ci porte la garantie « rien ici ne sait modifier », et
 * un test la vérifie sur son texte. Y ajouter une fonction d'écriture effacerait la seule
 * preuve mécanique qu'une lecture reste une lecture.
 */
export const RACINE = `https://googleads.googleapis.com/${VERSION}`
const AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth'
const JETON = 'https://oauth2.googleapis.com/token'

/**
 * La portée demandée, et ce qu'elle implique.
 *
 * `adwords` est la seule portée Google Ads. Elle couvre la lecture et l'écriture : Google
 * n'offre pas de lecture seule sur cette API. C'est dit à la personne sur l'écran de
 * connexion plutôt que caché — elle doit pouvoir croire ce qu'elle lit, et l'écran de
 * consentement de Google le lui dira de toute façon.
 */
export const PORTEES = ['https://www.googleapis.com/auth/adwords'] as const

export const DELAI_MS = 45_000

/**
 * De quoi la connexion a besoin pour s'ouvrir.
 *
 * Le client OAuth, et rien d'autre. Exiger en plus un jeton développeur fermerait la
 * connexion pour tout le monde depuis que Google ne les délivre plus — un verrou posé sur
 * une porte qui n'existe pas.
 */
export function estConfigureAds(): boolean {
  return env.googleClientId !== undefined && env.googleClientSecret !== undefined
}

function adresseRetour(): string {
  return `${env.appUrl}/api/connexions/google/retour`
}

function urlAutorisation(etat: string): string {
  const parametres = new URLSearchParams({
    client_id: env.googleClientId ?? '',
    redirect_uri: adresseRetour(),
    response_type: 'code',
    scope: PORTEES.join(' '),
    /*
     * `offline` et `consent` ensemble : sans eux, Google ne délivre un jeton de
     * rafraîchissement qu'à la toute première autorisation. Une personne qui reconnecte son
     * compte se retrouverait alors avec un accès qui expire en une heure et ne revient
     * jamais — une panne qui ne se voit que le lendemain.
     */
    access_type: 'offline',
    prompt: 'consent',
    state: etat,
  })
  return `${AUTORISATION}?${parametres.toString()}`
}

async function echangerCode(
  code: string,
): Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }> {
  return echangerJeton(JETON, {
    code,
    client_id: env.googleClientId ?? '',
    client_secret: env.googleClientSecret ?? '',
    redirect_uri: adresseRetour(),
    grant_type: 'authorization_code',
  })
}

async function rafraichir(
  refreshToken: string,
): Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }> {
  return echangerJeton(JETON, {
    refresh_token: refreshToken,
    client_id: env.googleClientId ?? '',
    client_secret: env.googleClientSecret ?? '',
    grant_type: 'refresh_token',
  })
}

/** Les en-têtes que Google Ads exige, jeton développeur compris. */
export function entetes(accessToken: string, compteId?: string): Record<string, string> {
  const base: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  }
  /*
   * Envoyé seulement s'il existe. Google l'ignore depuis septembre 2026 et annonce qu'il le
   * refusera dans une version majeure à venir : un en-tête vide envoyé par principe est
   * exactement ce qui fera échouer toutes les requêtes ce jour-là.
   */
  const jeton = env.googleAdsDeveloperToken
  if (jeton !== undefined && jeton !== '') base['developer-token'] = jeton
  /*
   * `login-customer-id` désigne le compte administrateur par lequel on atteint celui qu'on
   * lit. Il est ignoré par la liste des comptes accessibles, et indispensable dès qu'on
   * passe par une hiérarchie.
   */
  const gestionnaire = compteId ?? env.googleAdsLoginCustomerId
  if (gestionnaire !== undefined && gestionnaire !== '') {
    base['login-customer-id'] = gestionnaire.replace(/\D/gu, '')
  }
  return base
}

/**
 * Ce que Google refuse, dit à quelqu'un qui peut y faire quelque chose.
 *
 * La phrase d'orientation d'abord, la phrase de Google ensuite — et jamais l'une sans
 * l'autre. C'est la deuxième fois que ce fichier apprend la même leçon. Une première
 * version ne lisait pas les erreurs rendues en tableau et perdait la cause exacte ; celle-ci
 * la lisait, mais la jetait dès que le code HTTP était connu, au motif qu'on savait déjà
 * quoi conseiller. On ne le savait pas : derrière un même 403, Google écrit « ce compte n'a
 * pas accès au planificateur de mots-clés » ou « l'utilisateur n'a pas les droits sur ce
 * client », qui n'appellent pas du tout le même geste. Conseiller sans dire pourquoi envoie
 * quelqu'un vérifier ce qui marchait déjà.
 *
 * Rien de ce que Google renvoie ici ne porte de secret : ce sont ses messages d'erreur, pas
 * la requête.
 */
function refus(status: number, message: string): string {
  const dit = message === '' ? '' : ` Google précise : ${message.slice(0, 250)}`
  /*
   * Un refus que Google formule en anglais et que personne ne sait traduire en geste.
   * « Explorer access » est le niveau d'accès de départ de toute application : il ouvre la
   * lecture de ses propres campagnes et ferme le planificateur de mots-clés. Le dire en
   * français, avec l'endroit exact où le demander, vaut mieux qu'un conseil sur des droits
   * qui, eux, fonctionnent — c'est bien par ce même accès que les campagnes se lisent.
   */
  if (/explorer access/iu.test(message)) {
    return 'Le planificateur de mots-clés de Google n’est pas ouvert à votre application : elle est encore en accès « Explorer », qui permet de lire vos campagnes mais pas d’interroger les volumes de recherche. Demandez l’accès « Basic » depuis Google Ads → Outils → Configuration → API Center. C’est gratuit et généralement accordé en un à deux jours.'
  }
  if (status === 401) {
    return `Votre autorisation Google a expiré. Reconnectez votre compte Google Ads.${dit}`
  }
  if (status === 403) {
    return `Google refuse l’accès à ce compte publicitaire. Vérifiez que le compte connecté a bien les droits dessus.${dit}`
  }
  if (status === 429) {
    return `Google limite les demandes en ce moment. Naya réessaiera plus tard.${dit}`
  }
  return message === ''
    ? 'Naya ne parvient pas à récupérer vos données Google Ads pour l’instant.'
    : `Google répond : ${message.slice(0, 250)}`
}

/**
 * Le message d'erreur de Google, quelle que soit la forme de sa réponse.
 *
 * `searchStream` rend ses erreurs dans un tableau — c'est un flux, et un flux qui échoue
 * échoue par lots. Les autres points d'entrée rendent un objet. Ne lire que l'objet faisait
 * perdre la phrase de Google exactement là où elle est la plus utile : sur une requête mal
 * formée, c'est elle qui nomme le champ fautif, et sans elle il ne reste qu'un « Naya ne
 * parvient pas à lire vos données », qui n'aide personne.
 *
 * Le détail précis est encore un cran plus bas, dans `details[].errors[].message` : c'est
 * là que Google écrit « le champ X n'existe pas » plutôt que « requête invalide ».
 */
export function messageErreur(charge: unknown): string {
  const objet = Array.isArray(charge) ? charge[0] : charge
  const erreur = (objet as { error?: Record<string, unknown> } | null)?.error
  if (erreur === undefined || erreur === null) return ''

  const general = texte(erreur.message)
  const details = Array.isArray(erreur.details) ? erreur.details : []
  for (const detail of details) {
    const liste = (detail as { errors?: unknown })?.errors
    if (!Array.isArray(liste)) continue
    for (const precise of liste) {
      const message = texte((precise as { message?: unknown })?.message)
      if (message === '') continue
      const ou = champFautif(precise)
      const dit = ou === '' ? message : `${message} (champ : ${ou})`
      return general === '' ? dit : `${general} — ${dit}`
    }
  }
  return general
}

/**
 * Le chemin du champ que Google incrimine, quand il le donne.
 *
 * Troisième fois que ce fichier apprend la même leçon, et la plus coûteuse : « The required
 * field was not present » ne nomme pas le champ, mais Google le nomme juste à côté, sous
 * `location.fieldPathElements`. Sans lui, il ne reste qu'à deviner parmi les trente champs
 * d'une création de campagne — et deviner se paie en allers-retours.
 *
 * Les index sont conservés : « operations[4].create.ad » dit quelle opération d'un envoi
 * groupé a échoué, ce qui est la moitié de la réponse quand sept objets partent ensemble.
 */
function champFautif(precise: unknown): string {
  const location = (precise as { location?: { fieldPathElements?: unknown } } | null)?.location
  const elements = location?.fieldPathElements
  if (!Array.isArray(elements)) return ''

  return elements
    .map((element) => {
      const objet = (element ?? {}) as { fieldName?: unknown; index?: unknown }
      const nom = texte(objet.fieldName)
      if (nom === '') return ''
      return typeof objet.index === 'number' ? `${nom}[${objet.index}]` : nom
    })
    .filter((morceau) => morceau !== '')
    .join('.')
}

type ReponseGoogle = { status: number; corps: unknown; erreur: string }

async function appeler(
  url: string,
  accessToken: string,
  compteId: string | undefined,
  corps?: unknown,
): Promise<ReponseGoogle | null> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)
  try {
    const reponse = await fetch(url, {
      method: corps === undefined ? 'GET' : 'POST',
      headers: entetes(accessToken, compteId),
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      signal: controle.signal,
    })
    const charge = (await reponse.json().catch(() => null)) as unknown
    /*
     * Le détail technique reste ici. Ce qui remonte à l'écran est une phrase en français ;
     * ce qui part dans le journal ne porte ni jeton, ni identifiant de compte.
     */
    const erreur = reponse.status === 200 ? '' : messageErreur(charge)
    if (reponse.status !== 200) {
      logger.warn('Google Ads a refusé une lecture', { status: reponse.status })
    }
    return { status: reponse.status, corps: charge, erreur }
  } catch {
    return null
  } finally {
    clearTimeout(minuteur)
  }
}

/**
 * Une requête GAQL, en flux.
 *
 * `searchStream` rend tout en une réponse là où `search` pagine. Pour les volumes qui nous
 * concernent — quelques dizaines de campagnes, quelques centaines de journées — c'est un
 * appel au lieu de dix, et le quota est partagé entre tous les utilisateurs d'Evoliia.
 */
async function interroger(
  acces: AccesAds,
  requete: string,
): Promise<Lecture<Record<string, unknown>[]>> {
  const compte = acces.compteId.replace(/\D/gu, '')
  const reponse = await appeler(
    `${RACINE}/customers/${compte}/googleAds:searchStream`,
    acces.accessToken,
    env.googleAdsLoginCustomerId,
    { query: requete },
  )
  if (reponse === null) {
    return { ok: false, raison: 'Google Ads est momentanément injoignable. Naya réessaiera.' }
  }
  if (reponse.status !== 200) {
    return { ok: false, raison: refus(reponse.status, reponse.erreur) }
  }

  /*
   * La réponse est une liste de lots, chacun portant ses lignes. Lue défensivement : une
   * forme inattendue doit coûter la lecture, jamais lever au milieu d'une synchronisation
   * qui traite plusieurs comptes.
   */
  const lots = Array.isArray(reponse.corps) ? reponse.corps : [reponse.corps]
  const lignes: Record<string, unknown>[] = []
  for (const lot of lots) {
    const resultats = (lot as { results?: unknown })?.results
    if (!Array.isArray(resultats)) continue
    for (const ligne of resultats) {
      if (ligne !== null && typeof ligne === 'object') lignes.push(ligne as Record<string, unknown>)
    }
  }
  return { ok: true, valeur: lignes }
}

/** Un nombre venu de Google, qui rend ses entiers longs sous forme de chaîne. */
function nombre(valeur: unknown): number {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : 0
  if (typeof valeur === 'string') {
    const lu = Number(valeur)
    return Number.isFinite(lu) ? lu : 0
  }
  return 0
}

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : ''
}

/** Les formes qu'une plateforme regroupe sous un mot-clé, lues défensivement. */
function variantes(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return []
  return valeur.filter((une): une is string => typeof une === 'string' && une !== '')
}

async function listerComptes(accessToken: string): Promise<Lecture<CompteAds[]>> {
  const reponse = await appeler(
    `${RACINE}/customers:listAccessibleCustomers`,
    accessToken,
    undefined,
  )
  if (reponse === null) {
    return { ok: false, raison: 'Google Ads est momentanément injoignable. Réessayez.' }
  }
  if (reponse.status !== 200) return { ok: false, raison: refus(reponse.status, reponse.erreur) }

  const noms = (reponse.corps as { resourceNames?: unknown })?.resourceNames
  if (!Array.isArray(noms) || noms.length === 0) {
    return {
      ok: false,
      raison:
        'Ce compte Google n’a accès à aucun compte Google Ads. Vérifiez que vous vous êtes connecté avec le bon compte.',
    }
  }

  /*
   * La liste ne rend que des identifiants. Le nom, la devise et le fuseau se demandent
   * compte par compte — et c'est le moment de la connexion, pas une boucle quotidienne :
   * quelques appels une fois valent mieux qu'un écran qui n'affiche que des numéros.
   */
  const comptes: CompteAds[] = []
  for (const nom of noms.slice(0, 20)) {
    const compteId = texte(nom).split('/').at(-1) ?? ''
    if (compteId === '') continue
    const detail = await interroger(
      { accessToken, compteId },
      'SELECT customer.id, customer.descriptive_name, customer.currency_code,' +
        ' customer.time_zone, customer.manager FROM customer LIMIT 1',
    )
    if (!detail.ok) {
      /*
       * Un compte illisible ne doit pas priver la personne des autres : il arrive qu'une
       * autorisation couvre un compte fermé ou suspendu.
       */
      comptes.push({ compteId, nom: compteId, devise: '', fuseau: '', gestionnaire: false })
      continue
    }
    const client = (detail.valeur[0]?.customer ?? {}) as Record<string, unknown>
    comptes.push({
      compteId,
      nom: texte(client.descriptiveName) === '' ? compteId : texte(client.descriptiveName),
      devise: texte(client.currencyCode),
      fuseau: texte(client.timeZone),
      gestionnaire: client.manager === true,
    })
  }
  return { ok: true, valeur: comptes }
}

const REQUETE_CAMPAGNES = `
  SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status,
         campaign_budget.id, campaign_budget.amount_micros,
         campaign.primary_status_reasons
  FROM campaign
  WHERE campaign.status != 'REMOVED'
`

async function lireCampagnes(acces: AccesAds): Promise<Lecture<CampagneAds[]>> {
  const lecture = await interroger(acces, REQUETE_CAMPAGNES)
  if (!lecture.ok) return lecture

  return {
    ok: true,
    valeur: lecture.valeur.map((ligne) => {
      const campagne = (ligne.campaign ?? {}) as Record<string, unknown>
      const budget = (ligne.campaignBudget ?? {}) as Record<string, unknown>
      const raisons = Array.isArray(campagne.primaryStatusReasons)
        ? campagne.primaryStatusReasons.map((raison) => texte(raison))
        : []
      return {
        campagneId: String(nombre(campagne.id)),
        nom: texte(campagne.name),
        type: texte(campagne.advertisingChannelType),
        statut: texte(campagne.status),
        budgetMicros: nombre(budget.amountMicros),
        budgetId: String(nombre(budget.id)),
        /*
         * Google nomme lui-même la cause : on la reprend telle quelle plutôt que de la
         * déduire d'une dépense proche du budget, qui serait une devinette.
         */
        budgetLimite: raisons.includes('CAMPAIGN_BUDGET_CONSTRAINED'),
      }
    }),
  }
}

async function lireJournees(
  acces: AccesAds,
  depuis: string,
  jusqua: string,
): Promise<Lecture<JourneeAds[]>> {
  /*
   * Les bornes sont recomposées à partir des chiffres lus, jamais interpolées dans la
   * requête telles qu'elles arrivent : une date est le seul endroit de cette requête où
   * une valeur extérieure entre, et GAQL n'a pas de paramètres liés.
   */
  const borne = (valeur: string): string => {
    const propre = /^\d{4}-\d{2}-\d{2}$/u.test(valeur) ? valeur : ''
    return propre
  }
  const debut = borne(depuis)
  const fin = borne(jusqua)
  if (debut === '' || fin === '') {
    return { ok: false, raison: 'Période demandée invalide.' }
  }

  const lecture = await interroger(
    acces,
    `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions,
            metrics.clicks, metrics.conversions, metrics.conversions_value
     FROM campaign
     WHERE segments.date BETWEEN '${debut}' AND '${fin}'`,
  )
  if (!lecture.ok) return lecture

  return {
    ok: true,
    valeur: lecture.valeur.map((ligne) => {
      const campagne = (ligne.campaign ?? {}) as Record<string, unknown>
      const segments = (ligne.segments ?? {}) as Record<string, unknown>
      const mesures = (ligne.metrics ?? {}) as Record<string, unknown>
      return {
        campagneId: String(nombre(campagne.id)),
        jour: texte(segments.date),
        coutMicros: nombre(mesures.costMicros),
        impressions: nombre(mesures.impressions),
        clics: nombre(mesures.clicks),
        conversions: nombre(mesures.conversions),
        valeurConversion: nombre(mesures.conversionsValue),
      }
    }),
  }
}

/**
 * Les champs de Google, ramenés au vocabulaire d'Evoliia.
 *
 * Google distingue trois formats d'image publicitaire — paysage, carré, portrait — et deux
 * formats de logo. Cette distinction est une contrainte de mise en page, pas de contenu :
 * pour dire « cette annonce a douze titres et six images », les cinq se réduisent à deux.
 * Le format exact redeviendra nécessaire le jour où l'on déposera une image, et il se lit
 * alors sur l'image elle-même.
 */
const CHAMPS: Record<string, ChampAds> = {
  HEADLINE: 'titre',
  LONG_HEADLINE: 'titre-long',
  DESCRIPTION: 'description',
  MARKETING_IMAGE: 'image',
  SQUARE_MARKETING_IMAGE: 'image',
  PORTRAIT_MARKETING_IMAGE: 'image',
  LOGO: 'logo',
  LANDSCAPE_LOGO: 'logo',
}

/**
 * Les annonces responsives d'une campagne Recherche.
 *
 * Leurs titres sont portés en ligne dans l'annonce, sans identifiant propre : ce sont des
 * textes, pas des objets. C'est la différence avec une Performance Max, et la raison pour
 * laquelle l'unicité, plus loin, porte sur le texte et non sur un numéro.
 */
const REQUETE_ANNONCES = `
  SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id,
         ad_group_ad.ad.responsive_search_ad.headlines,
         ad_group_ad.ad.responsive_search_ad.descriptions
  FROM ad_group_ad
  WHERE ad_group_ad.status != 'REMOVED'
    AND ad_group.status != 'REMOVED'
    AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
`

/**
 * Les groupes d'éléments d'une Performance Max, et leurs morceaux.
 *
 * Une seule requête rend les deux : chaque ligne porte le groupe et l'un de ses éléments.
 * Les demander séparément coûterait deux appels sur un plafond partagé pour la même chose.
 */
const REQUETE_ELEMENTS = `
  SELECT asset_group.id, asset_group.name, asset_group.status, campaign.id,
         asset_group_asset.field_type,
         asset.id, asset.text_asset.text, asset.image_asset.full_size.url
  FROM asset_group_asset
  WHERE asset_group_asset.status != 'REMOVED'
`

/**
 * Les mots-clés d'un groupe d'annonces.
 *
 * C'est ce qui dit de quoi parle le contenant, et rien d'autre ne le dit. Sans eux, on
 * connaît le nom du groupe — « Groupe d'annonces 1 » — et la demande du site entier, ce qui
 * conduit tout droit à proposer un titre sur les bracelets dans un groupe qui vend des
 * bougies. Google montrerait alors ce titre à quelqu'un qui cherche une bougie.
 *
 * Les mots-clés négatifs sont lus puis écartés en code plutôt qu'en requête : ils disent ce
 * que le groupe refuse, ce qui est l'inverse de ce qu'on cherche, et un filtre de moins dans
 * la requête est un champ de moins qui peut être refusé.
 */
const REQUETE_MOTS_CLES = `
  SELECT ad_group.id, ad_group_criterion.keyword.text, ad_group_criterion.negative
  FROM ad_group_criterion
  WHERE ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.status != 'REMOVED'
    AND ad_group.status != 'REMOVED'
`

/** Le texte d'un élément textuel de Google, qui les emballe dans un objet. */
function texteElement(valeur: unknown): { texte: string; performance: string } {
  const objet = (valeur ?? {}) as Record<string, unknown>
  return {
    texte: texte(objet.text),
    performance: texte(objet.assetPerformanceLabel),
  }
}

async function lireCreatif(
  acces: AccesAds,
): Promise<Lecture<{ groupes: GroupeAds[]; elements: ElementAds[] }>> {
  const groupes = new Map<string, GroupeAds>()
  const elements: ElementAds[] = []
  /*
   * Un texte identique deux fois dans un même contenant n'existe pas chez Google, mais une
   * campagne Recherche peut porter plusieurs annonces dans le même groupe, et elles se
   * partagent souvent des titres. Sans ce filtre, le même titre serait compté deux fois.
   */
  const vus = new Set<string>()

  const ajouter = (element: ElementAds) => {
    if (element.texte === '') return
    const cle = `${element.groupeId}::${element.champ}::${element.texte}`
    if (vus.has(cle)) return
    vus.add(cle)
    elements.push(element)
  }

  const annonces = await interroger(acces, REQUETE_ANNONCES)
  if (!annonces.ok) return annonces

  for (const ligne of annonces.valeur) {
    const groupe = (ligne.adGroup ?? {}) as Record<string, unknown>
    const campagne = (ligne.campaign ?? {}) as Record<string, unknown>
    const annonce = (((ligne.adGroupAd ?? {}) as Record<string, unknown>).ad ?? {}) as Record<
      string,
      unknown
    >
    const responsive = (annonce.responsiveSearchAd ?? {}) as Record<string, unknown>
    const groupeId = String(nombre(groupe.id))
    if (groupeId === '0') continue

    groupes.set(groupeId, {
      groupeId,
      campagneId: String(nombre(campagne.id)),
      nom: texte(groupe.name),
      genre: 'annonces',
      statut: texte(groupe.status),
    })

    for (const [champ, brut] of [
      ['titre', responsive.headlines],
      ['description', responsive.descriptions],
    ] as const) {
      if (!Array.isArray(brut)) continue
      for (const entree of brut) {
        const lu = texteElement(entree)
        ajouter({ groupeId, champ, texte: lu.texte, elementId: '', performance: lu.performance })
      }
    }
  }

  const motsCles = await interroger(acces, REQUETE_MOTS_CLES)
  if (!motsCles.ok) return motsCles

  for (const ligne of motsCles.valeur) {
    const groupe = (ligne.adGroup ?? {}) as Record<string, unknown>
    const critere = (ligne.adGroupCriterion ?? {}) as Record<string, unknown>
    const groupeId = String(nombre(groupe.id))
    if (groupeId === '0' || !groupes.has(groupeId)) continue
    // Un mot-clé négatif dit ce que le groupe refuse : c'est l'inverse de ce qu'on cherche.
    if (critere.negative === true) continue
    const mot = texte(((critere.keyword ?? {}) as Record<string, unknown>).text)
    ajouter({ groupeId, champ: 'mot-cle', texte: mot, elementId: '', performance: '' })
  }

  const pmax = await interroger(acces, REQUETE_ELEMENTS)
  if (!pmax.ok) return pmax

  for (const ligne of pmax.valeur) {
    const groupe = (ligne.assetGroup ?? {}) as Record<string, unknown>
    const campagne = (ligne.campaign ?? {}) as Record<string, unknown>
    const element = (ligne.asset ?? {}) as Record<string, unknown>
    const groupeId = String(nombre(groupe.id))
    if (groupeId === '0') continue

    groupes.set(groupeId, {
      groupeId,
      campagneId: String(nombre(campagne.id)),
      nom: texte(groupe.name),
      genre: 'elements',
      statut: texte(groupe.status),
    })

    const champ = CHAMPS[texte(((ligne.assetGroupAsset ?? {}) as Record<string, unknown>).fieldType)]
    if (champ === undefined) continue

    const contenu =
      champ === 'image' || champ === 'logo'
        ? texte(
            (((element.imageAsset ?? {}) as Record<string, unknown>).fullSize as
              | Record<string, unknown>
              | undefined)?.url,
          )
        : texte(((element.textAsset ?? {}) as Record<string, unknown>).text)

    /*
     * Pas de note de Google sur les éléments d'une Performance Max : la documentation
     * annonce `asset_group_asset.performance_label`, l'API v22 répond que le champ n'existe
     * pas. C'est l'API qui fait foi. Le champ reste vide plutôt que d'être rempli d'une
     * valeur inventée, et l'écran n'affiche alors aucune pastille — ce qui est la vérité.
     */
    ajouter({
      groupeId,
      champ,
      texte: contenu,
      elementId: String(nombre(element.id)),
      performance: '',
    })
  }

  return { ok: true, valeur: { groupes: [...groupes.values()], elements } }
}

/**
 * Les annonces d'un contenant, lues juste avant d'y écrire.
 *
 * L'identifiant vient de notre base, mais il traverse une requête GAQL, qui n'a pas de
 * paramètres liés : il est donc réduit à ses chiffres avant d'y entrer. C'est la même
 * discipline que pour les dates — tout ce qui entre dans une requête est vérifié, y compris
 * ce qui vient de chez nous, parce qu'une valeur de confiance qui cesse de l'être ne
 * s'annonce pas.
 */
async function lireAnnoncesDuGroupe(
  acces: AccesAds,
  groupeId: string,
): Promise<Lecture<AnnonceAds[]>> {
  const identifiant = groupeId.replace(/\D/gu, '')
  if (identifiant === '') return { ok: false, raison: 'Contenant inconnu.' }

  const lecture = await interroger(
    acces,
    `SELECT ad_group_ad.ad.resource_name,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions
     FROM ad_group_ad
     WHERE ad_group.id = ${identifiant}
       AND ad_group_ad.status != 'REMOVED'
       AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'`,
  )
  if (!lecture.ok) return lecture

  const textes = (brut: unknown): TexteAnnonceAds[] => {
    if (!Array.isArray(brut)) return []
    return brut
      .map((entree) => {
        const objet = (entree ?? {}) as Record<string, unknown>
        return { texte: texte(objet.text), epingle: texte(objet.pinnedField) }
      })
      .filter((une) => une.texte !== '')
  }

  return {
    ok: true,
    valeur: lecture.valeur
      .map((ligne) => {
        const annonce = (((ligne.adGroupAd ?? {}) as Record<string, unknown>).ad ?? {}) as Record<
          string,
          unknown
        >
        const responsive = (annonce.responsiveSearchAd ?? {}) as Record<string, unknown>
        return {
          resourceName: texte(annonce.resourceName),
          titres: textes(responsive.headlines),
          descriptions: textes(responsive.descriptions),
        }
      })
      .filter((annonce) => annonce.resourceName !== ''),
  }
}

/**
 * Combien d'éléments un groupe porte déjà, par champ.
 *
 * Google compte ses limites par type de champ — vingt images carrées, quinze titres, cinq
 * descriptions — et il les vérifie au rattachement, pas à la création. Un rattachement
 * refusé laisse donc l'élément créé sans emploi, et l'API ne sait pas le supprimer. Compter
 * avant est la seule façon de ne pas en semer dans le compte de quelqu'un.
 */
async function compterElementsDuGroupe(
  acces: AccesAds,
  groupeId: string,
): Promise<Lecture<Record<string, number>>> {
  const identifiant = groupeId.replace(/\D/gu, '')
  if (identifiant === '') return { ok: false, raison: 'Contenant inconnu.' }

  const lecture = await interroger(
    acces,
    `SELECT asset_group_asset.field_type
     FROM asset_group_asset
     WHERE asset_group.id = ${identifiant}
       AND asset_group_asset.status != 'REMOVED'`,
  )
  if (!lecture.ok) return lecture

  const comptes: Record<string, number> = {}
  for (const ligne of lecture.valeur) {
    const champ = texte(((ligne.assetGroupAsset ?? {}) as Record<string, unknown>).fieldType)
    if (champ === '') continue
    comptes[champ] = (comptes[champ] ?? 0) + 1
  }
  return { ok: true, valeur: comptes }
}

/**
 * Ce que les gens ont tapé.
 *
 * Seules les campagnes à mots-clés en rendent. Une Performance Max ne livre que des
 * catégories agrégées, et cette requête ne la couvre tout simplement pas : elle rendra zéro
 * ligne pour ces campagnes-là, ce qui est la vérité et non une panne.
 *
 * La limite n'est pas de la prudence : au-delà de quelques centaines de termes, la traîne
 * est faite de requêtes vues une fois, qui n'apprennent rien et coûtent du contexte.
 */
async function lireTermes(
  acces: AccesAds,
  depuis: string,
  jusqua: string,
): Promise<Lecture<TermeAds[]>> {
  const borne = (valeur: string) => (/^\d{4}-\d{2}-\d{2}$/u.test(valeur) ? valeur : '')
  const debut = borne(depuis)
  const fin = borne(jusqua)
  if (debut === '' || fin === '') return { ok: false, raison: 'Période demandée invalide.' }

  const lecture = await interroger(
    acces,
    `SELECT campaign.id, search_term_view.search_term, metrics.impressions, metrics.clicks,
            metrics.conversions, metrics.cost_micros
     FROM search_term_view
     WHERE segments.date BETWEEN '${debut}' AND '${fin}'
     ORDER BY metrics.impressions DESC
     LIMIT 400`,
  )
  if (!lecture.ok) return lecture

  return {
    ok: true,
    valeur: lecture.valeur.map((ligne) => {
      const campagne = (ligne.campaign ?? {}) as Record<string, unknown>
      const vue = (ligne.searchTermView ?? {}) as Record<string, unknown>
      const mesures = (ligne.metrics ?? {}) as Record<string, unknown>
      return {
        campagneId: String(nombre(campagne.id)),
        terme: texte(vue.searchTerm),
        impressions: nombre(mesures.impressions),
        clics: nombre(mesures.clicks),
        conversions: nombre(mesures.conversions),
        coutMicros: nombre(mesures.costMicros),
      }
    }),
  }
}

/**
 * Les mots-clés d'un groupe d'annonces, relus à l'instant.
 *
 * Lus avant d'en déposer un, pour deux raisons. Le compte d'abord : notre base est relue une
 * fois par semaine, et quelqu'un a pu ajouter vingt mots-clés dans Google Ads entre-temps.
 * Le doublon ensuite : Google refuse deux fois le même mot dans la même correspondance, et
 * un refus qui dit « le critère existe déjà » n'aide personne — mieux vaut le dire avant.
 *
 * La correspondance est rendue avec le texte : le même mot en expression et en exact sont
 * deux achats différents, et les confondre ferait refuser un dépôt légitime.
 */
async function lireMotsClesDuGroupe(
  acces: AccesAds,
  groupeId: string,
): Promise<Lecture<Array<{ texte: string; correspondance: string }>>> {
  const identifiant = groupeId.replace(/\D/gu, '')
  if (identifiant === '') return { ok: false, raison: 'Contenant inconnu.' }

  const lecture = await interroger(
    acces,
    `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
     FROM ad_group_criterion
     WHERE ad_group.id = ${identifiant}
       AND ad_group_criterion.type = 'KEYWORD'
       AND ad_group_criterion.negative = false
       AND ad_group_criterion.status != 'REMOVED'`,
  )
  if (!lecture.ok) return lecture

  return {
    ok: true,
    valeur: lecture.valeur
      .map((ligne) => {
        const critere = (ligne.adGroupCriterion ?? {}) as Record<string, unknown>
        const mot = (critere.keyword ?? {}) as Record<string, unknown>
        return {
          texte: texte(mot.text),
          // PHRASE | EXACT | BROAD, ramenés au vocabulaire d'Evoliia. Un mot large existe
          // chez Google même si Evoliia n'en dépose pas : il compte dans le groupe.
          correspondance: texte(mot.matchType).toLowerCase(),
        }
      })
      .filter((mot) => mot.texte !== ''),
  }
}

/**
 * Ce que le marché tape autour de quelques mots, et ce que ça coûterait.
 *
 * Le planificateur de mots-clés, et c'est la pièce que Search Console ne peut pas fournir.
 * Search Console dit ce que les gens ont tapé pour trouver ce site-là : une demande réelle,
 * mais vue par le petit bout de la lorgnette, et sans aucun prix. Le planificateur dit le
 * volume du marché et la fourchette de coût par clic. Acheter des mots-clés sur Search
 * Console seul reviendrait à payer pour des visites déjà obtenues gratuitement, sans savoir
 * à quel prix — c'est exactement l'erreur que ce croisement existe pour éviter.
 *
 * Trois précautions.
 *
 * **Le marché et la langue sont obligatoires.** Une fourchette de coût par clic n'a de sens
 * que rapportée à un pays et à une langue. Les omettre rendrait les chiffres du monde
 * entier : vrais, et inutilisables pour une boutique suisse.
 *
 * **Les graines sont bornées à vingt.** C'est la limite de Google, et la dépasser fait
 * refuser l'appel entier — donc perdre les dix-neuf autres.
 *
 * **Une seule page.** L'appel consomme le quota d'API partagé par tous les utilisateurs
 * d'Evoliia. La première page porte déjà plus d'idées qu'un groupe d'annonces n'en peut
 * contenir ; aller chercher la suivante coûterait le quota de quelqu'un d'autre.
 */
async function ideesDeMotsCles(
  acces: AccesAds,
  graines: string[],
  marche: string,
  langue: string,
): Promise<Lecture<IdeeMotCle[]>> {
  const compte = acces.compteId.replace(/\D/gu, '')
  const semences = graines
    .map((graine) => graine.trim())
    .filter((graine) => graine !== '')
    .slice(0, GRAINES_MAX)
  if (semences.length === 0) return { ok: true, valeur: [] }

  const reponse = await appeler(
    `${RACINE}/customers/${compte}:generateKeywordIdeas`,
    acces.accessToken,
    env.googleAdsLoginCustomerId,
    {
      language: langue,
      geoTargetConstants: [marche],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      includeAdultKeywords: false,
      keywordSeed: { keywords: semences },
    },
  )
  if (reponse === null) {
    return { ok: false, raison: 'Google Ads est momentanément injoignable. Réessayez.' }
  }
  if (reponse.status !== 200) return { ok: false, raison: refus(reponse.status, reponse.erreur) }

  const resultats = (reponse.corps as { results?: unknown })?.results
  if (!Array.isArray(resultats)) return { ok: true, valeur: [] }

  return {
    ok: true,
    valeur: resultats
      .map((brut) => {
        const ligne = (brut ?? {}) as Record<string, unknown>
        const mesures = (ligne.keywordIdeaMetrics ?? {}) as Record<string, unknown>
        return {
          texte: texte(ligne.text),
          volume: nombre(mesures.avgMonthlySearches),
          concurrence: texte(mesures.competition),
          coutBasMicros: nombre(mesures.lowTopOfPageBidMicros),
          coutHautMicros: nombre(mesures.highTopOfPageBidMicros),
          variantes: variantes(ligne.closeVariants),
        }
      })
      .filter((idee) => idee.texte !== ''),
  }
}

/**
 * Ce que Google sait de mots-clés précis — ceux-là et pas d'autres.
 *
 * Distinct de `ideesDeMotsCles`, et la différence compte. Le planificateur d'idées part de
 * quelques mots et en propose d'autres : il n'a aucune obligation de rendre les métriques
 * des mots qu'on lui a donnés. C'est ce qui faisait sortir « quartz bleu » sans volume ni
 * prix alors qu'il venait des chiffres réels du site — on l'avait bien envoyé, Google avait
 * simplement préféré parler d'autre chose.
 *
 * Cet appel-ci ne propose rien : il répond sur la liste exacte. Les deux sont donc
 * complémentaires — l'un trouve ce qu'on ignore, l'autre chiffre ce qu'on sait déjà.
 *
 * Les variantes proches que Google regroupe sont ignorées : il agrège « bougie citrine » et
 * « bougies citrine » sous une seule ligne, et les séparer inventerait une précision que la
 * donnée n'a pas.
 */
async function metriquesDeMotsCles(
  acces: AccesAds,
  motsCles: string[],
  marche: string,
  langue: string,
): Promise<Lecture<IdeeMotCle[]>> {
  const compte = acces.compteId.replace(/\D/gu, '')
  const liste = motsCles
    .map((mot) => mot.trim())
    .filter((mot) => mot !== '')
    .slice(0, MOTS_CLES_CHIFFRES)
  if (liste.length === 0) return { ok: true, valeur: [] }

  const reponse = await appeler(
    `${RACINE}/customers/${compte}:generateKeywordHistoricalMetrics`,
    acces.accessToken,
    env.googleAdsLoginCustomerId,
    {
      keywords: liste,
      language: langue,
      geoTargetConstants: [marche],
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      includeAdultKeywords: false,
    },
  )
  if (reponse === null) {
    return { ok: false, raison: 'Google Ads est momentanément injoignable. Réessayez.' }
  }
  if (reponse.status !== 200) return { ok: false, raison: refus(reponse.status, reponse.erreur) }

  const resultats = (reponse.corps as { results?: unknown })?.results
  if (!Array.isArray(resultats)) return { ok: true, valeur: [] }

  return {
    ok: true,
    valeur: resultats
      .map((brut) => {
        const ligne = (brut ?? {}) as Record<string, unknown>
        /*
         * `keywordMetrics` ici, `keywordIdeaMetrics` dans l'autre appel : Google donne deux
         * noms au même objet selon le point d'entrée. Se tromper de nom rendrait des
         * volumes nuls sans la moindre erreur — un échec silencieux, le pire des deux.
         */
        const mesures = (ligne.keywordMetrics ?? {}) as Record<string, unknown>
        return {
          texte: texte(ligne.text),
          volume: nombre(mesures.avgMonthlySearches),
          concurrence: texte(mesures.competition),
          coutBasMicros: nombre(mesures.lowTopOfPageBidMicros),
          coutHautMicros: nombre(mesures.highTopOfPageBidMicros),
          /*
           * Les formes que Google regroupe. Un commentaire de la version précédente disait
           * les ignorer « pour ne pas inventer une précision que la donnée n'a pas ». C'était
           * l'inverse : c'est en les ignorant qu'on a laissé passer « quartz rose » et
           * « quartzrose » comme deux achats, pour une seule et même recherche.
           */
          variantes: variantes(ligne.closeVariants),
        }
      })
      .filter((mesure) => mesure.texte !== ''),
  }
}

/**
 * La langue que chaque campagne cible, telle qu'elle la déclare.
 *
 * Lue et non devinée. La rédaction écrivait en français quoi qu'il arrive, ce qui pour une
 * boutique suisse servant trois langues produit des titres corrects dans la mauvaise langue
 * — une annonce que son public ne comprend pas consomme ses impressions sans être cliquée.
 *
 * Une campagne qui cible plusieurs langues ne rend rien : on ne saurait pas laquelle choisir
 * pour ses annonces, et en choisir une au hasard serait exactement la faute qu'on corrige.
 * L'appelant retombe alors sur la langue du site, ce qu'il sait être un repli.
 */
async function lireLanguesDesCampagnes(
  acces: AccesAds,
): Promise<Lecture<Record<string, string>>> {
  const lecture = await interroger(
    acces,
    `SELECT campaign.id, campaign_criterion.language.language_constant
     FROM campaign_criterion
     WHERE campaign_criterion.type = 'LANGUAGE'
       AND campaign_criterion.negative = false
       AND campaign.status != 'REMOVED'`,
  )
  if (!lecture.ok) return lecture

  const parCampagne = new Map<string, Set<string>>()
  for (const ligne of lecture.valeur) {
    const campagne = String(nombre(((ligne.campaign ?? {}) as Record<string, unknown>).id))
    const critere = (ligne.campaignCriterion ?? {}) as Record<string, unknown>
    const langue = texte(((critere.language ?? {}) as Record<string, unknown>).languageConstant)
    if (campagne === '0' || langue === '') continue
    const vues = parCampagne.get(campagne) ?? new Set<string>()
    vues.add(langue)
    parCampagne.set(campagne, vues)
  }

  const langues: Record<string, string> = {}
  for (const [campagne, vues] of parCampagne) {
    // Une seule, ou rien. Choisir parmi plusieurs serait deviner.
    if (vues.size === 1) langues[campagne] = [...vues][0] as string
  }
  return { ok: true, valeur: langues }
}

export const googleAds: AdPlatformProvider = {
  id: 'google-ads',
  nom: 'Google Ads',
  estConfigure: estConfigureAds,
  urlAutorisation,
  echangerCode,
  rafraichir,
  listerComptes,
  lireCampagnes,
  lireJournees,
  lireCreatif,
  lireTermes,
  lireAnnoncesDuGroupe,
  compterElementsDuGroupe,
  ideesDeMotsCles,
  metriquesDeMotsCles,
  lireMotsClesDuGroupe,
  lireLanguesDesCampagnes,
}
