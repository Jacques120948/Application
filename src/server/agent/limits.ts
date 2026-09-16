import { readSettings } from '@/server/settings/store'

/**
 * Ce qu'une exécution de l'agent a le droit de consommer.
 *
 * C'est le fichier le plus important de l'agent, et il doit être lu avant les autres. Un
 * agent, par construction, décide lui-même de son prochain pas ; sans bornes, une boucle
 * qui tourne mal ne s'arrête pas, et la facture non plus. La règle du produit est
 * explicite : mille créateurs ne doivent pas pouvoir produire des milliers d'euros de
 * factures. Ces bornes sont ce qui la fait tenir.
 *
 * Trois bornes indépendantes, et la première atteinte gagne.
 *
 * **Les étapes.** Une étape est un aller-retour avec le modèle. Six suffisent à lire deux
 * pages, proposer une modification, la corriger une fois et conclure. Une demande qui en
 * exigerait davantage est une demande qu'il vaut mieux découper.
 *
 * **Les jetons.** Une étape peut être petite ou énorme. Compter les étapes sans compter
 * les jetons laisserait passer six appels de cent mille jetons.
 *
 * **Les crédits.** C'est la borne qui parle au créateur, et la seule qu'il voit. Elle
 * plafonne ce qu'une seule demande peut lui coûter, quoi qu'il arrive.
 *
 * Les valeurs sont réglables depuis l'administration. Celles du code sont le point de
 * départ décidé le 16 septembre 2026 : prudentes, à élargir sur mesures et non sur
 * impression.
 */

export type AgentLimits = {
  /** Allers-retours avec le modèle. */
  maxSteps: number
  /** Jetons cumulés, entrée et sortie confondues, sur toute l'exécution. */
  maxTokens: number
  /** Crédits qu'une exécution peut coûter au créateur. */
  maxCredits: number
  /** Durée au bout de laquelle on arrête, même si le reste tient. */
  maxDurationMs: number
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxSteps: 6,
  maxTokens: 40_000,
  maxCredits: 40,
  maxDurationMs: 4 * 60_000,
}

/**
 * En dessous, il n'y a plus de quoi travailler.
 *
 * Une étape coûte deux à trois crédits ; à moins de cinq, l'agent lirait une page et
 * s'arrêterait, en ayant dépensé sans rien produire. Refuser d'emblée est plus honnête, et
 * le message dit alors la vraie raison : il manque des crédits, pas de la capacité.
 */
export const MINIMUM_RESERVATION = 5

export const AGENT_SETTINGS = {
  maxSteps: 'agent.max.steps',
  maxTokens: 'agent.max.tokens',
  maxCredits: 'agent.max.credits',
  maxDurationMs: 'agent.max.duration',
} as const

/** Une borne réglée trop bas rendrait l'agent inutile ; trop haut, dangereux. */
const BOUNDS: Record<keyof AgentLimits, { min: number; max: number }> = {
  maxSteps: { min: 2, max: 24 },
  maxTokens: { min: 5_000, max: 400_000 },
  maxCredits: { min: 5, max: 400 },
  maxDurationMs: { min: 30_000, max: 10 * 60_000 },
}

function bounded(raw: string | undefined, key: keyof AgentLimits): number {
  const fallback = DEFAULT_AGENT_LIMITS[key]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  const { min, max } = BOUNDS[key]
  return Math.min(max, Math.max(min, Math.round(value)))
}

export async function loadAgentLimits(): Promise<AgentLimits> {
  const settings = await readSettings(Object.values(AGENT_SETTINGS))
  return {
    maxSteps: bounded(settings[AGENT_SETTINGS.maxSteps], 'maxSteps'),
    maxTokens: bounded(settings[AGENT_SETTINGS.maxTokens], 'maxTokens'),
    maxCredits: bounded(settings[AGENT_SETTINGS.maxCredits], 'maxCredits'),
    maxDurationMs: bounded(settings[AGENT_SETTINGS.maxDurationMs], 'maxDurationMs'),
  }
}

export type BudgetState = {
  steps: number
  tokens: number
  credits: number
  startedAt: number
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: string }

export function newBudget(): BudgetState {
  return { steps: 0, tokens: 0, credits: 0, startedAt: Date.now() }
}

/**
 * Reste-t-il de quoi faire une étape de plus ?
 *
 * Vérifié **avant** chaque appel et non après : constater le dépassement une fois l'appel
 * payé ne protège de rien. Les motifs sont écrits pour être montrés au créateur tels
 * quels — c'est lui qui décide alors de découper sa demande.
 */
export function canContinue(budget: BudgetState, limits: AgentLimits): BudgetVerdict {
  if (budget.steps >= limits.maxSteps) {
    return { ok: false, reason: `J’ai atteint ma limite de ${limits.maxSteps} étapes pour une demande.` }
  }
  if (budget.tokens >= limits.maxTokens) {
    return { ok: false, reason: 'Cette demande dépasse ce que je peux lire et écrire en une fois.' }
  }
  if (budget.credits >= limits.maxCredits) {
    return { ok: false, reason: `Cette demande a atteint le plafond de ${limits.maxCredits} crédits.` }
  }
  if (Date.now() - budget.startedAt >= limits.maxDurationMs) {
    return { ok: false, reason: 'Cette demande prend trop de temps. Découpez-la en deux.' }
  }
  return { ok: true }
}
