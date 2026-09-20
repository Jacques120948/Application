import { env } from '@/lib/env'

/**
 * Interroger un assistant comme le ferait un client, et lire ce qu'il répond.
 *
 * C'est la seule façon honnête de savoir si une marque sort dans un assistant. Evoliia
 * répète depuis le début qu'un bon score GEO ne garantit aucune apparition ; c'était vrai,
 * et c'était un aveu d'impuissance — le produit disait ce qu'il ne pouvait pas savoir sans
 * jamais aller le chercher.
 *
 * Trois décisions, et la première est celle qui coûte des plateformes.
 *
 * **On ne mesure que ce qu'on interroge vraiment.** ChatGPT n'a pas d'API qui reproduise ce
 * que voit son utilisateur : ni le même modèle, ni la même recherche, ni la même mémoire.
 * Les encadrés IA de Google et son mode conversationnel n'ont aucune API du tout. Les
 * afficher demanderait de racler des pages de résultats, ce qui est contraire aux
 * conditions de Google et expose le produit. Ils sont donc absents, et l'écran dit
 * pourquoi. Trois plateformes mesurées valent mieux que cinq annoncées.
 *
 * **La recherche est obligatoire.** Un assistant qui répond sans chercher répond de
 * mémoire, et sa mémoire a des mois. Ce qu'on veut mesurer, c'est ce que voit un client
 * aujourd'hui — donc une réponse ancrée sur des pages réellement consultées.
 *
 * **Les sources sont gardées.** C'est la moitié utile du relevé : savoir qu'on n'est pas
 * cité ne dit rien, savoir qui l'est à sa place dit quoi faire.
 */

export type Plateforme = 'gemini' | 'claude' | 'perplexity'

/** Ce que rend une interrogation, quelle que soit la plateforme. */
export type Reponse =
  | { ok: true; texte: string; sources: string[] }
  | { ok: false; raison: string }

const DELAI_MS = 60_000

/** Un appel borné en temps : un assistant qui ne répond pas ne doit pas retenir la nuit. */
async function appeler(url: string, init: RequestInit): Promise<Response | null> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)
  try {
    return await fetch(url, { ...init, signal: controle.signal })
  } catch {
    return null
  } finally {
    clearTimeout(minuteur)
  }
}

// ──────────────────────────────── Gemini ─────────────────────────────────────

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_MODELE = 'gemini-2.5-flash'

type ChargeGemini = {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] }
  }[]
  error?: { message?: string }
}

/**
 * Gemini, ancré sur la recherche Google.
 *
 * `google_search` est l'outil d'ancrage : sans lui le modèle répond de mémoire, et une
 * mémoire d'entraînement ne dit rien de ce que voit un client aujourd'hui. Google facture
 * chaque recherche déclenchée, et le modèle peut en déclencher plusieurs pour une seule
 * question — c'est la part variable du coût, et c'est pourquoi le relevé est facturé au
 * forfait plutôt qu'au réel.
 */
async function demanderGemini(question: string): Promise<Reponse> {
  const cle = env.geminiApiKey
  if (cle === undefined) return { ok: false, raison: 'Gemini n’est pas configuré.' }

  const reponse = await appeler(`${GEMINI_API}/models/${GEMINI_MODELE}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cle },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: question }] }],
      tools: [{ google_search: {} }],
    }),
  })
  if (reponse === null) return { ok: false, raison: 'Gemini est momentanément injoignable.' }

  const charge = (await reponse.json().catch(() => null)) as ChargeGemini | null
  if (reponse.status !== 200 || charge === null) {
    return { ok: false, raison: charge?.error?.message?.slice(0, 150) ?? 'Gemini a refusé.' }
  }

  const candidat = charge.candidates?.[0]
  const texte = (candidat?.content?.parts ?? [])
    .map((partie) => partie.text ?? '')
    .join('\n')
    .trim()
  if (texte === '') return { ok: false, raison: 'Gemini n’a rien répondu.' }

  const sources = (candidat?.groundingMetadata?.groundingChunks ?? [])
    .map((bloc) => bloc.web?.uri ?? '')
    .filter((uri) => uri !== '')

  return { ok: true, texte, sources }
}

// ──────────────────────────────── Claude ─────────────────────────────────────

const CLAUDE_API = 'https://api.anthropic.com/v1/messages'
const CLAUDE_MODELE = 'claude-haiku-4-5'
const CLAUDE_VERSION = '2023-06-01'

type BlocClaude = {
  type?: string
  text?: string
  content?: unknown
}

type ChargeClaude = { content?: BlocClaude[]; error?: { message?: string } }

/**
 * Claude, avec l'outil de recherche web.
 *
 * Le modèle le moins cher de la famille suffit : on ne lui demande pas de raisonner, on lui
 * demande de répondre à une question de client comme il le ferait. Un modèle plus capable
 * coûterait plus pour une réponse qu'on ne juge pas — on la lit.
 */
async function demanderClaude(question: string): Promise<Reponse> {
  const cle = env.anthropicApiKey
  if (cle === undefined || cle === '') {
    return { ok: false, raison: 'Claude n’est pas configuré.' }
  }

  const reponse = await appeler(CLAUDE_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cle,
      'anthropic-version': CLAUDE_VERSION,
    },
    body: JSON.stringify({
      model: CLAUDE_MODELE,
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: question }],
    }),
  })
  if (reponse === null) return { ok: false, raison: 'Claude est momentanément injoignable.' }

  const charge = (await reponse.json().catch(() => null)) as ChargeClaude | null
  if (reponse.status !== 200 || charge === null) {
    return { ok: false, raison: charge?.error?.message?.slice(0, 150) ?? 'Claude a refusé.' }
  }

  const blocs = charge.content ?? []
  const texte = blocs
    .filter((bloc) => bloc.type === 'text')
    .map((bloc) => bloc.text ?? '')
    .join('\n')
    .trim()
  if (texte === '') return { ok: false, raison: 'Claude n’a rien répondu.' }

  /*
   * Les sources arrivent dans les blocs de résultat de recherche, dont la forme est une
   * liste d'objets portant une adresse. On la lit défensivement : une forme inattendue doit
   * coûter les sources, jamais le relevé.
   */
  const sources: string[] = []
  for (const bloc of blocs) {
    if (bloc.type !== 'web_search_tool_result' || !Array.isArray(bloc.content)) continue
    for (const resultat of bloc.content) {
      const url = (resultat as { url?: unknown }).url
      if (typeof url === 'string' && url !== '') sources.push(url)
    }
  }

  return { ok: true, texte, sources }
}

// ────────────────────────────── Perplexity ───────────────────────────────────

const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions'
const PERPLEXITY_MODELE = 'sonar'

type ChargePerplexity = {
  choices?: { message?: { content?: string } }[]
  citations?: string[]
  error?: { message?: string }
}

/**
 * Perplexity, dont la recherche est comprise dans le prix des jetons.
 *
 * C'est la plateforme la moins chère des trois, et de loin : aucun frais de recherche
 * séparé. Elle n'est active que si une clé est configurée — sans elle, la fonction
 * fonctionne sur les deux autres plutôt que d'échouer.
 */
async function demanderPerplexity(question: string): Promise<Reponse> {
  const cle = env.perplexityApiKey
  if (cle === undefined) return { ok: false, raison: 'Perplexity n’est pas configuré.' }

  const reponse = await appeler(PERPLEXITY_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cle}` },
    body: JSON.stringify({
      model: PERPLEXITY_MODELE,
      messages: [{ role: 'user', content: question }],
    }),
  })
  if (reponse === null) return { ok: false, raison: 'Perplexity est momentanément injoignable.' }

  const charge = (await reponse.json().catch(() => null)) as ChargePerplexity | null
  if (reponse.status !== 200 || charge === null) {
    return { ok: false, raison: charge?.error?.message?.slice(0, 150) ?? 'Perplexity a refusé.' }
  }

  const texte = (charge.choices?.[0]?.message?.content ?? '').trim()
  if (texte === '') return { ok: false, raison: 'Perplexity n’a rien répondu.' }

  return { ok: true, texte, sources: (charge.citations ?? []).filter((url) => url !== '') }
}

// ─────────────────────────────── Le choix ────────────────────────────────────

const INTERROGATEURS: Record<Plateforme, (question: string) => Promise<Reponse>> = {
  gemini: demanderGemini,
  claude: demanderClaude,
  perplexity: demanderPerplexity,
}

/** Les plateformes réellement interrogeables, c'est-à-dire celles dont la clé est posée. */
export function plateformesDisponibles(): Plateforme[] {
  const disponibles: Plateforme[] = []
  if (env.geminiApiKey !== undefined) disponibles.push('gemini')
  if (env.anthropicApiKey !== undefined && env.anthropicApiKey !== '') disponibles.push('claude')
  if (env.perplexityApiKey !== undefined) disponibles.push('perplexity')
  return disponibles
}

/** Pose la question à une plateforme. Ne lève jamais : un refus est une réponse. */
export async function demander(plateforme: Plateforme, question: string): Promise<Reponse> {
  return INTERROGATEURS[plateforme](question)
}
