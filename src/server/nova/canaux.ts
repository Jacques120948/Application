import type { CanalNova } from '@/lib/nova'
import type { VisiteShopify } from '@/server/integrations/providers/shopify'

/**
 * D'où vient une vente : la normalisation des sources.
 *
 * Chaque plateforme nomme la même chose à sa façon. Une campagne Meta arrive étiquetée
 * « facebook », « Facebook », « fb », « ig » ou « meta » selon qui a écrit le lien ; une
 * visite Google arrive par un paramètre `gclid`, un `utm_source=google` ou un simple
 * référent. Additionner par étiquette brute ferait cinq lignes pour un seul canal, et aucun
 * chiffre juste.
 *
 * Trois règles.
 *
 * **Regrouper sans effacer.** Le canal est calculé ; l'étiquette d'origine est gardée à côté
 * (`origine`), telle qu'elle est arrivée. Une règle de regroupement fausse se corrige sans
 * avoir perdu la donnée.
 *
 * **Payant d'abord, et sur un indice explicite.** Un lien Facebook partagé par un client
 * n'est pas une publicité. On ne range une visite en Google Ads ou Meta Ads que sur un
 * signe qui ne trompe pas : un `utm_medium` payant, ou l'identifiant de clic que Google
 * ajoute lui-même à ses annonces.
 *
 * **Ce qu'on ne sait pas s'appelle « non attribué ».** Une commande sans visite connue
 * n'est ni « directe » ni « autre » : c'est un trou dans la mesure, et il doit se voir.
 */

/** Les étiquettes brutes, ramenées à une source unique. Comparées en minuscules. */
const SOURCES: readonly (readonly [string, readonly string[]])[] = [
  ['meta', ['facebook', 'fb', 'meta', 'instagram', 'ig', 'facebook.com', 'instagram.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com', 'l.instagram.com']],
  ['google', ['google', 'adwords', 'googleads', 'google-ads', 'google_ads', 'google.com']],
  ['bing', ['bing', 'microsoft', 'bing.com']],
  ['tiktok', ['tiktok', 'tiktok.com']],
  ['linkedin', ['linkedin', 'linkedin.com', 'lnkd.in']],
  ['pinterest', ['pinterest', 'pinterest.com', 'pin.it']],
  ['x', ['twitter', 'x', 't.co', 'x.com', 'twitter.com']],
  ['youtube', ['youtube', 'youtube.com', 'youtu.be']],
  ['snapchat', ['snapchat', 'snapchat.com']],
  ['newsletter', ['newsletter', 'klaviyo', 'mailchimp', 'brevo', 'sendinblue', 'email', 'e-mail', 'mail']],
]

/** Les assistants IA, par l'adresse d'où vient la visite ou par l'étiquette qu'ils posent. */
const ASSISTANTS: readonly (readonly [string, readonly string[]])[] = [
  ['ChatGPT', ['chatgpt.com', 'chat.openai.com', 'openai.com', 'chatgpt']],
  ['Perplexity', ['perplexity.ai', 'www.perplexity.ai', 'perplexity']],
  ['Gemini', ['gemini.google.com', 'bard.google.com', 'gemini']],
  ['Copilot', ['copilot.microsoft.com', 'copilot']],
  ['Claude', ['claude.ai', 'claude']],
  ['Le Chat', ['chat.mistral.ai', 'mistral']],
  ['DeepSeek', ['chat.deepseek.com', 'deepseek']],
  ['You.com', ['you.com']],
]

const MOTEURS = ['google.', 'bing.com', 'duckduckgo.com', 'search.yahoo.', 'yahoo.com', 'ecosia.org', 'qwant.com', 'search.brave.com', 'yandex.', 'baidu.com', 'startpage.com']

const RESEAUX = ['meta', 'tiktok', 'linkedin', 'pinterest', 'x', 'youtube', 'snapchat']

const MEDIUMS_PAYANTS = ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search', 'paidsocial', 'paid_social', 'paid-social', 'cpm', 'cpv', 'display', 'ads', 'ad', 'sem', 'retargeting']

const MEDIUMS_EMAIL = ['email', 'e-mail', 'mail', 'newsletter']

const MEDIUMS_SOCIAL = ['social', 'social-network', 'social_network', 'organic_social', 'organic-social', 'sm']

function propre(valeur: string): string {
  return valeur.trim().toLowerCase()
}

/** L'hôte d'une adresse, sans « www. ». Vide quand l'adresse est illisible. */
export function hoteDe(adresse: string): string {
  if (adresse.trim() === '') return ''
  try {
    return new URL(adresse).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return ''
  }
}

/** Une étiquette de source ramenée à son nom commun. Inconnue : rendue telle quelle, en minuscules. */
export function normaliserSource(brut: string): string {
  const valeur = propre(brut).replace(/^www\./u, '')
  if (valeur === '') return ''
  for (const [nom, alias] of SOURCES) if (alias.includes(valeur)) return nom
  return valeur
}

/** L'assistant IA derrière une adresse ou une étiquette, ou `null`. */
export function assistantDe(hote: string, source: string): string | null {
  const candidats = [propre(hote), propre(source).replace(/^www\./u, '')]
  for (const [nom, alias] of ASSISTANTS) {
    if (candidats.some((candidat) => candidat !== '' && alias.includes(candidat))) return nom
  }
  return null
}

function estMoteur(hote: string): boolean {
  // Gemini est chez Google, et ce n'est pas une recherche : l'assistant a été vu avant.
  return MOTEURS.some((moteur) => hote.startsWith(moteur) || hote.includes(`.${moteur}`))
}

/** Le paramètre qu'ajoutent les annonces Google elles-mêmes : le seul indice sans ambiguïté. */
function clicGoogleAds(referrer: string): boolean {
  return /[?&](gclid|gbraid|wbraid)=/iu.test(referrer)
}

export type Attribution = {
  canal: CanalNova
  /** L'étiquette telle qu'elle est arrivée : « facebook / cpc », « chatgpt.com », « direct ». */
  origine: string
  /** Le nom de l'assistant, pour le canal IA. */
  assistant: string | null
}

/**
 * Le canal d'une visite — le « dernier clic » tel que la boutique l'a enregistré.
 *
 * Pur et sans appel : c'est ce qui permet de le tester ligne à ligne, et de le rejouer sur
 * des données anciennes le jour où une règle change.
 */
export function canalDeVisite(visite: VisiteShopify | null): Attribution {
  if (visite === null) return { canal: 'inconnu', origine: 'inconnue', assistant: null }

  const source = normaliserSource(visite.utm.source)
  const medium = propre(visite.utm.medium)
  const hote = hoteDe(visite.referrer)
  const hoteNormal = normaliserSource(hote)
  const etiquette = visite.utm.source !== '' ? visite.utm.source : hote !== '' ? hote : visite.source
  const origine = `${etiquette === '' ? 'direct' : etiquette}${visite.utm.medium === '' ? '' : ` / ${visite.utm.medium}`}`

  const assistant = assistantDe(hote, visite.utm.source)
  if (assistant !== null) return { canal: 'ia', origine, assistant }

  const payant = MEDIUMS_PAYANTS.includes(medium)
  if (clicGoogleAds(visite.referrer) || (payant && source === 'google')) {
    return { canal: 'google-ads', origine, assistant: null }
  }
  if (payant && source === 'meta') return { canal: 'meta-ads', origine, assistant: null }

  if (MEDIUMS_EMAIL.includes(medium) || source === 'newsletter') return { canal: 'email', origine, assistant: null }
  if (medium === 'organic' || (visite.utm.source === '' && estMoteur(hote))) {
    return { canal: 'seo', origine, assistant: null }
  }
  if (MEDIUMS_SOCIAL.includes(medium) || RESEAUX.includes(source) || RESEAUX.includes(hoteNormal)) {
    return { canal: 'social', origine, assistant: null }
  }
  // Une étiquette posée mais qu'on ne sait pas ranger : payante ou non, on ne devine pas.
  if (visite.utm.source !== '' || visite.utm.medium !== '') return { canal: 'autres', origine, assistant: null }
  if (hote !== '') return { canal: 'referral', origine, assistant: null }
  return { canal: 'direct', origine: 'direct', assistant: null }
}
