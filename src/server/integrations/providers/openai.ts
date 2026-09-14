import type { KeyVerifier } from '../verify'

/**
 * Connecteur « clé OpenAI du créateur », pour générer des images.
 *
 * Même logique que la clé Anthropic : la clé est celle du créateur, les images sont
 * facturées sur son compte, Evoliia ne relaie que les octets. Ce module sait deux choses :
 * dire si une clé est valide (un appel gratuit, la liste des modèles) et demander une
 * image. La clé lui est passée par le gestionnaire au moment de l'appel, et disparaît.
 */

const API = 'https://api.openai.com/v1'
/** Modèle d'images. Une constante : la changer est une décision, pas un réglage. */
export const OPENAI_IMAGE_MODEL = 'gpt-image-1'
const TIMEOUT_MS = 90_000

export const verifyOpenAiKey: KeyVerifier = async (apiKey) => {
  if (!apiKey.startsWith('sk-')) {
    return { ok: false, reason: 'Une clé OpenAI commence par « sk- ». Vérifiez ce que vous avez collé.' }
  }
  try {
    const response = await fetch(`${API}/models?limit=1`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'OpenAI refuse cette clé. Elle est peut-être révoquée ou incomplète.' }
    }
    if (!response.ok) {
      return { ok: false, reason: 'OpenAI a répondu de travers. Réessayez dans un instant.' }
    }
    return { ok: true, label: 'Compte OpenAI' }
  } catch {
    return { ok: false, reason: 'Impossible de joindre OpenAI pour vérifier la clé. Réessayez dans un instant.' }
  }
}

export type ImageResult =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; kind: 'key' | 'quota' | 'refused' | 'unavailable'; reason: string }

/** Une image, en paysage, depuis le compte du créateur. */
export async function generateOpenAiImage(apiKey: string, prompt: string): Promise<ImageResult> {
  let response: Response
  try {
    response = await fetch(`${API}/images/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt,
        n: 1,
        size: '1536x1024',
        quality: 'medium',
        output_format: 'webp',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, kind: 'unavailable', reason: 'OpenAI ne répond pas. Réessayez dans un instant.' }
  }
  return readImageResponse(response, 'OpenAI', async () => {
    const body = (await response.json()) as { data?: Array<{ b64_json?: string }> }
    const b64 = body.data?.[0]?.b64_json
    return b64 === undefined ? null : { bytes: Buffer.from(b64, 'base64'), mime: 'image/webp' }
  })
}

/** Lecture commune des réponses d'un fournisseur d'images : les refus sont traduits, pas devinés. */
export async function readImageResponse(
  response: Response,
  provider: string,
  extract: () => Promise<{ bytes: Uint8Array; mime: string } | null>,
): Promise<ImageResult> {
  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: 'key', reason: `${provider} refuse votre clé. Reconnectez le service depuis Connexions.` }
  }
  if (response.status === 429 || response.status === 402) {
    return {
      ok: false,
      kind: 'quota',
      reason: `${provider} a atteint la limite de votre compte (quota ou crédit). Vérifiez votre compte ${provider}.`,
    }
  }
  if (response.status === 400 || response.status === 422) {
    return {
      ok: false,
      kind: 'refused',
      reason: `${provider} a refusé cette description. Reformulez-la, sans marque ni personne réelle.`,
    }
  }
  if (!response.ok) {
    return { ok: false, kind: 'unavailable', reason: `${provider} a répondu de travers. Réessayez dans un instant.` }
  }
  try {
    const image = await extract()
    if (image === null || image.bytes.length === 0) {
      return { ok: false, kind: 'refused', reason: `${provider} n'a renvoyé aucune image pour cette description.` }
    }
    return { ok: true, ...image }
  } catch {
    return { ok: false, kind: 'unavailable', reason: `La réponse de ${provider} est illisible.` }
  }
}
