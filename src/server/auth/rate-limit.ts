import { rateLimited } from '@/lib/errors'

/**
 * Limitation de débit à fenêtre glissante, en mémoire du processus.
 *
 * Limite connue et assumée : sur plusieurs instances, chaque instance compte
 * séparément. C'est suffisant pour ralentir une attaque par force brute en V1 ; le
 * passage à un compteur partagé (Redis) est prévu en phase 2 et ne change que ce fichier.
 */

type Bucket = { hits: number[]; blockedUntil?: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 50_000

export type RateLimitRule = {
  /** Nombre d'actions autorisées dans la fenêtre. */
  limit: number
  /** Durée de la fenêtre en millisecondes. */
  windowMs: number
  /** Durée de blocage après dépassement, en millisecondes. */
  blockMs?: number
}

export const RULES = {
  login: { limit: 8, windowMs: 10 * 60_000, blockMs: 10 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000, blockMs: 30 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000, blockMs: 30 * 60_000 },
  aiOperation: { limit: 30, windowMs: 60_000 },
  appWrite: { limit: 60, windowMs: 60_000 },
  /** Questions à l'assistant d'une application, par visiteur. */
  appAssistant: { limit: 10, windowMs: 5 * 60_000, blockMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>

function prune(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return
  for (const [key, bucket] of buckets) {
    const alive = bucket.hits.some((hit) => hit > now - 3_600_000)
    if (!alive && (bucket.blockedUntil ?? 0) < now) buckets.delete(key)
    if (buckets.size <= MAX_BUCKETS * 0.8) break
  }
}

/** Consomme une unité. Lève une erreur `RATE_LIMITED` si le quota est dépassé. */
export function consume(key: string, rule: RateLimitRule): void {
  const now = Date.now()
  prune(now)
  const bucket = buckets.get(key) ?? { hits: [] }

  if (bucket.blockedUntil !== undefined && bucket.blockedUntil > now) {
    throw rateLimited('Trop de tentatives. Patientez quelques minutes avant de réessayer.')
  }

  bucket.hits = bucket.hits.filter((hit) => hit > now - rule.windowMs)
  if (bucket.hits.length >= rule.limit) {
    if (rule.blockMs !== undefined) bucket.blockedUntil = now + rule.blockMs
    buckets.set(key, bucket)
    throw rateLimited('Trop de tentatives. Patientez quelques minutes avant de réessayer.')
  }

  bucket.hits.push(now)
  buckets.set(key, bucket)
}

/** Réinitialise un compteur : appelé après une action réussie (connexion valide). */
export function reset(key: string): void {
  buckets.delete(key)
}

/** Usage réservé aux tests. */
export function clearAll(): void {
  buckets.clear()
}
