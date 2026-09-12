import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'

/**
 * Accès à l'API Claude.
 *
 * Deux modes assumés et visibles dans l'interface :
 *   - assistant configuré : les opérations passent par le modèle ;
 *   - assistant non configuré (pas de clé) : la plateforme continue de fonctionner avec
 *     ses modèles de départ déterministes, et le dit explicitement à l'utilisateur.
 *     Aucun écran ne laisse croire qu'une IA a travaillé alors que non.
 *
 * S'y ajoute un troisième cas, qui ne concerne pas Evoliia mais ses créateurs : une
 * application publiée peut répondre avec la clé Anthropic de son créateur. Le client est
 * alors construit pour l'appel puis abandonné — une clé qui ne nous appartient pas n'a
 * aucune raison de survivre en mémoire au-delà de la requête qui l'utilise.
 */

let cached: Anthropic | null = null

export function isAiAvailable(): boolean {
  return env.aiEnabled
}

export function getAnthropic(): Anthropic {
  if (cached) return cached
  cached = new Anthropic({
    apiKey: env.anthropicApiKey,
    maxRetries: 2,
    timeout: 120_000,
  })
  return cached
}

/**
 * Client construit sur la clé d'un créateur, jamais mémorisé.
 *
 * Moins de patience que pour la clé d'Evoliia : si le compte du créateur est à sec ou sa
 * clé révoquée, réessayer deux fois ne fera qu'allonger l'attente d'un visiteur.
 */
export function getAnthropicWithKey(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
}

export type KeyCheck = { ok: true; label: string } | { ok: false; reason: string }

/**
 * Vérifie une clé de créateur avant de l'enregistrer.
 *
 * La liste des modèles est gratuite et ne consomme aucun jeton : c'est la façon la moins
 * coûteuse de distinguer une clé valide d'une faute de frappe. Enregistrer sans vérifier
 * reviendrait à laisser le créateur découvrir son erreur le jour où un visiteur pose une
 * question.
 *
 * Le message renvoyé ne contient jamais la clé ni un fragment de celle-ci.
 */
export async function checkCreatorKey(apiKey: string): Promise<KeyCheck> {
  if (!apiKey.startsWith('sk-ant-')) {
    return {
      ok: false,
      reason: "Une clé Anthropic commence par « sk-ant- ». Vérifiez ce que vous avez collé.",
    }
  }

  try {
    const models = await getAnthropicWithKey(apiKey).models.list({ limit: 1 })
    const first = models.data[0]
    return {
      ok: true,
      label: first === undefined ? 'Compte Anthropic' : `Compte Anthropic · ${first.id}`,
    }
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : null
    if (status === 401 || status === 403) {
      return {
        ok: false,
        reason: "Anthropic refuse cette clé. Elle est peut-être révoquée ou incomplète.",
      }
    }
    return {
      ok: false,
      reason: "Impossible de joindre Anthropic pour vérifier la clé. Réessayez dans un instant.",
    }
  }
}
