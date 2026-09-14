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

export const verifyGeminiKey: KeyVerifier = async (apiKey) => {
  if (!apiKey.startsWith('AIza')) {
    return { ok: false, reason: 'Une clé Google AI commence par « AIza ». Vérifiez ce que vous avez collé.' }
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

export async function generateGeminiImage(apiKey: string, prompt: string): Promise<ImageResult> {
  let response: Response
  try {
    response = await fetch(`${API}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2' } },
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
