import type { KeyVerifier } from '../verify'
import { readImageResponse, type ImageResult } from './openai'

/**
 * Connecteur « clé Google Gemini du créateur », pour générer des images.
 *
 * Même contrat que le connecteur OpenAI : vérifier la clé par un appel gratuit, demander
 * une image sur le compte du créateur. La clé voyage en en-tête, jamais dans l'adresse,
 * pour ne pas finir dans un journal d'accès.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image'
const TIMEOUT_MS = 90_000

/**
 * Ce qui ne peut pas être une clé, quel que soit le format du moment.
 *
 * On ne vérifie plus le préfixe, et c'est une leçon payée : le contrôle exigeait « AIza »,
 * et Google a commencé à délivrer des clés en « AQ. ». Un contrôle de forme codé en dur
 * finit toujours par refuser une clé parfaitement valide, et personne ne comprend pourquoi —
 * surtout pas la personne qui vient de la créer.
 *
 * Ne reste ici que ce qui ne peut être vrai d'aucune clé : vide, trop courte, ou contenant
 * une espace. C'est ce qui attrape un texte d'exemple recollé tel quel, et rien d'autre.
 * Pour le reste, c'est Google qui décide — et sa réponse est maintenant traduite fidèlement.
 */
const LONGUEUR_MINIMALE = 20

export function ressembleAUneCle(valeur: string): boolean {
  const propre = valeur.trim()
  return propre.length >= LONGUEUR_MINIMALE && !/\s/.test(propre)
}

export const verifyGeminiKey: KeyVerifier = async (apiKey) => {
  if (!ressembleAUneCle(apiKey)) {
    return {
      ok: false,
      reason: 'Cela ne ressemble pas à une clé : vérifiez ce que vous avez collé, sans espace.',
    }
  }
  try {
    const response = await fetch(`${API}/models?pageSize=1`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'Google refuse cette clé. Elle est peut-être révoquée ou restreinte.' }
    }
    if (!response.ok) {
      return { ok: false, reason: 'Google a répondu de travers. Réessayez dans un instant.' }
    }
    return { ok: true, label: 'Compte Google AI' }
  } catch {
    return { ok: false, reason: 'Impossible de joindre Google pour vérifier la clé. Réessayez dans un instant.' }
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
  }>
}

/**
 * Le cadrage demandé à Google.
 *
 * Trois demis par défaut, le format d'une image de page. Le carré sert aux portraits : une
 * image large recadrée en rond perd la moitié du visage, et aucun recadrage après coup ne
 * rattrape ce qui n'a jamais été dessiné.
 */
export type AspectRatio = '3:2' | '1:1'

export async function generateGeminiImage(
  apiKey: string,
  prompt: string,
  aspectRatio: AspectRatio = '3:2',
): Promise<ImageResult> {
  let response: Response
  try {
    response = await fetch(`${API}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, kind: 'unavailable', reason: 'Google ne répond pas. Réessayez dans un instant.' }
  }
  return readImageResponse(response, 'Google', async () => {
    const body = (await response.json()) as GeminiResponse
    const part = body.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData?.data !== undefined)
    const data = part?.inlineData?.data
    return data === undefined
      ? null
      : { bytes: Buffer.from(data, 'base64'), mime: part?.inlineData?.mimeType ?? 'image/png' }
  })
}
