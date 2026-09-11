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

/** Réservé aux tests : réinitialise le client mémorisé. */
export function resetAnthropicClient(): void {
  cached = null
}
