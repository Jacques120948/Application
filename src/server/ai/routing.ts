import type { CreditedOperation } from '@/server/billing/credits'

/**
 * Routage des modèles et tarification (exigence 37).
 *
 * Table de configuration plutôt que conditions dispersées : changer de modèle pour une
 * opération se fait ici, et nulle part ailleurs.
 */

export const MODELS = {
  /** Raisonnement structurant : génération complète, diagnostic. */
  reasoning: 'claude-opus-5',
  /** Opérations fréquentes et cadrées par le schéma. */
  fast: 'claude-sonnet-5',
} as const

export type ModelId = (typeof MODELS)[keyof typeof MODELS]

/** Tarifs en micro-dollars par jeton. Source : tarification publique de l'API Claude. */
const PRICING: Record<ModelId, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
}

export type OperationProfile = {
  model: ModelId
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
}

export const OPERATION_PROFILES: Record<CreditedOperation, OperationProfile> = {
  ideas: { model: MODELS.fast, maxTokens: 4_000, effort: 'medium' },
  blueprint: { model: MODELS.fast, maxTokens: 3_000, effort: 'medium' },
  generate: { model: MODELS.reasoning, maxTokens: 16_000, effort: 'high' },
  edit: { model: MODELS.fast, maxTokens: 4_000, effort: 'medium' },
  diagnose: { model: MODELS.reasoning, maxTokens: 6_000, effort: 'high' },
  marketing: { model: MODELS.fast, maxTokens: 6_000, effort: 'medium' },
}

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

/** Coût réel d'un appel, en micro-dollars. Alimente l'écran de marge de l'administration. */
export function costMicros(model: string, usage: TokenUsage): number {
  const pricing = PRICING[model as ModelId]
  if (!pricing) return 0
  const billedInput = Math.max(0, usage.inputTokens - usage.cachedTokens)
  return Math.round(
    billedInput * pricing.input +
      usage.cachedTokens * pricing.cacheRead +
      usage.outputTokens * pricing.output,
  )
}
