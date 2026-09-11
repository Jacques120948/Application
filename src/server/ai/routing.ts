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
  /**
   * Réponses courtes et nombreuses : l'assistant intégré aux applications créées.
   *
   * Ce sont les visiteurs du créateur qui déclenchent ces appels, et c'est le créateur qui
   * les paie. Le modèle le moins cher est donc le bon choix par défaut.
   */
  economical: 'claude-haiku-4-5',
} as const

export type ModelId = (typeof MODELS)[keyof typeof MODELS]

/** Tarifs en micro-dollars par jeton. Source : tarification publique de l'API Claude. */
const PRICING: Record<ModelId, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
}

export type OperationProfile = {
  model: ModelId
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
}

/**
 * La génération complète se fait en deux temps (voir src/server/ai/schemas.ts) et les
 * deux n'ont pas les mêmes besoins : décider la structure demande du raisonnement,
 * rédiger le contenu d'une page est une tâche cadrée par le schéma. Mesuré sur une
 * génération réelle de six pages, ce découpage divise le coût par deux sans perte
 * visible de qualité.
 */
export const GENERATION_STEPS = {
  plan: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'high' },
  page: { model: MODELS.fast, maxTokens: 6_000, effort: 'medium' },
} as const satisfies Record<string, OperationProfile>

export const OPERATION_PROFILES: Record<CreditedOperation, OperationProfile> = {
  ideas: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'medium' },
  // La validation engage l'utilisateur à construire ou à renoncer : elle mérite le
  // modèle de raisonnement, même si elle est appelée souvent.
  validate: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'high' },
  // Le cahier des charges est lu et approuvé par le créateur, et il commande ensuite la
  // construction : c'est le document le plus structurant du parcours.
  specsheet: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'high' },
  blueprint: { model: MODELS.fast, maxTokens: 3_000, effort: 'medium' },
  generate: { model: MODELS.reasoning, maxTokens: 16_000, effort: 'high' },
  edit: { model: MODELS.fast, maxTokens: 4_000, effort: 'medium' },
  // Réponse courte à un visiteur. Volume potentiellement élevé, enjeu faible par réponse.
  assistant: { model: MODELS.economical, maxTokens: 700, effort: 'low' },
  // Le coach explique le produit, il ne le construit pas. Réponse courte, modèle rapide.
  coach: { model: MODELS.economical, maxTokens: 800, effort: 'low' },
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
