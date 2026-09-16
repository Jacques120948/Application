import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { readSettings } from '@/server/settings/store'
import type { TokenUsage } from '@/server/ai/routing'

/**
 * Ce que coûte un appel, et ce qu'il vaut en crédits.
 *
 * Trois réglages vivaient dans le code : le tarif de chaque modèle, l'unité de conversion
 * en crédits, et le nom du modèle utilisé pour chaque rôle. Les y laisser obligeait à un
 * déploiement le jour où Anthropic change un prix ou publie un modèle — c'est-à-dire le
 * jour où il faut réagir vite. Ils se règlent désormais depuis l'administration.
 *
 * Trois partis pris.
 *
 * **Le code garde les valeurs actuelles en secours.** Une table vide, une base
 * inaccessible, un modèle inconnu : le calcul retombe sur ce qui est écrit ici, qui est
 * exactement ce qui s'appliquait avant. Un réglage absent ne peut donc pas faire payer
 * zéro — ce qui serait la pire des pannes silencieuses.
 *
 * **Les tarifs sont dans l'unité d'Anthropic** : des centimes de dollar par million de
 * jetons. C'est ce qui est publié sur leur page de tarifs, donc ce qui se recopie sans
 * conversion et sans faute d'un facteur mille.
 *
 * **Le multiplicateur est explicite et vaut 1 par défaut.** Le rendre visible ne change
 * rien tant qu'il vaut 1 ; au-delà, c'est une décision commerciale, et elle se prend dans
 * l'administration, jamais dans un correctif.
 */

/** Tarif d'un modèle, en centimes de dollar par million de jetons. */
export type ModelPrice = {
  label: string
  input: number
  output: number
  cacheRead: number
}

/**
 * Les tarifs en vigueur au moment où ce code a été écrit. Ils servent de secours et de
 * valeurs de départ pour l'administration ; ce ne sont pas eux qui font foi une fois la
 * table remplie.
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPrice> = {
  'claude-opus-5': { label: 'Opus 5 — raisonnement', input: 500, output: 2_500, cacheRead: 50 },
  'claude-sonnet-5': { label: 'Sonnet 5 — courant', input: 200, output: 1_000, cacheRead: 20 },
  'claude-haiku-4-5': { label: 'Haiku 4.5 — économique', input: 100, output: 500, cacheRead: 10 },
}

/**
 * 1 crédit = 5 000 micro-dollars de coût API. Cette unité n'est pas arbitraire : construire
 * une application coûte environ 0,105 USD, soit 21 crédits, et l'offre Launch en accorde
 * 100 par mois. La changer recalibre tout le système d'un seul endroit.
 */
export const DEFAULT_MICROS_PER_CREDIT = 5_000

/** Marge appliquée au coût réel. À 1, le créateur paie exactement ce qu'Evoliia dépense. */
export const DEFAULT_COST_MULTIPLIER = 1

/**
 * Ce qu'une image coûte à Evoliia, en micro-dollars.
 *
 * Elle ne se compte pas en jetons : le fournisseur facture à l'image, à prix ferme. La
 * valeur ci-dessous est celle de Nano Banana (`gemini-2.5-flash-image`) constatée en
 * septembre 2026 — environ quatre centimes, soit huit crédits pour le créateur. Comme tous
 * les tarifs, elle se règle depuis l'administration : le jour où Google change son prix est
 * précisément celui où il ne faut pas avoir à déployer.
 */
export const DEFAULT_IMAGE_MICROS = 39_000

export const PRICING_SETTINGS = {
  multiplier: 'ai.cost.multiplier',
  microsPerCredit: 'ai.credit.micros',
  imageMicros: 'ai.image.micros',
} as const

export type PricingTable = {
  prices: Record<string, ModelPrice>
  /** Marge Evoliia. Multiplie le coût réel avant conversion en crédits. */
  multiplier: number
  microsPerCredit: number
  /** Coût d'une image, en micro-dollars. Facturé à l'image, jamais aux jetons. */
  imageMicros: number
}

/**
 * Les tarifs changent rarement et sont lus à chaque appel : un cache court évite une
 * requête par appel sans rendre un changement de tarif invisible plus d'une minute.
 */
const CACHE_TTL_MS = 60_000
let cache: { table: PricingTable; readAt: number } | null = null

/** Oublie le cache. Appelé après une modification depuis l'administration, et par les tests. */
export function forgetPricingCache(): void {
  cache = null
}

function positiveNumber(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export async function loadPricing(): Promise<PricingTable> {
  const now = Date.now()
  if (cache !== null && now - cache.readAt < CACHE_TTL_MS) return cache.table

  let table: PricingTable = {
    prices: { ...DEFAULT_MODEL_PRICING },
    multiplier: DEFAULT_COST_MULTIPLIER,
    microsPerCredit: DEFAULT_MICROS_PER_CREDIT,
    imageMicros: DEFAULT_IMAGE_MICROS,
  }

  try {
    const [rows, settings] = await Promise.all([
      prisma.aiModelPricing.findMany({ where: { isActive: true } }),
      readSettings([
        PRICING_SETTINGS.multiplier,
        PRICING_SETTINGS.microsPerCredit,
        PRICING_SETTINGS.imageMicros,
      ]),
    ])
    const prices = { ...DEFAULT_MODEL_PRICING }
    for (const row of rows) {
      prices[row.model] = {
        label: row.label,
        input: row.inputCentsPerMTok,
        output: row.outputCentsPerMTok,
        cacheRead: row.cacheReadCentsPerMTok,
      }
    }
    table = {
      prices,
      multiplier: positiveNumber(
        settings[PRICING_SETTINGS.multiplier] ?? null,
        DEFAULT_COST_MULTIPLIER,
      ),
      microsPerCredit: Math.max(
        1,
        Math.round(
          positiveNumber(
            settings[PRICING_SETTINGS.microsPerCredit] ?? null,
            DEFAULT_MICROS_PER_CREDIT,
          ),
        ),
      ),
      imageMicros: Math.round(
        positiveNumber(settings[PRICING_SETTINGS.imageMicros] ?? null, DEFAULT_IMAGE_MICROS),
      ),
    }
  } catch {
    // Une base injoignable ne doit pas empêcher de facturer : on garde les valeurs du code.
    logger.warn('tarifs IA illisibles, valeurs de secours appliquées')
  }

  cache = { table, readAt: now }
  return table
}

/**
 * Coût réel d'un appel, en micro-dollars, avant marge.
 *
 * Les jetons lus au cache sont facturés à part et retirés de l'entrée facturée plein
 * tarif : les compter deux fois gonflerait la facture du créateur d'une économie qu'il
 * n'a pas faite.
 */
export function costMicros(model: string, usage: TokenUsage, table: PricingTable): number {
  const price = table.prices[model]
  if (price === undefined) {
    logger.warn('modèle sans tarif connu, coût compté à zéro', { model })
    return 0
  }
  const billedInput = Math.max(0, usage.inputTokens - usage.cachedTokens)
  // Centimes par million de jetons → micro-dollars : jetons × centimes ÷ 100.
  return Math.round(
    (billedInput * price.input + usage.cachedTokens * price.cacheRead + usage.outputTokens * price.output) /
      100,
  )
}

/**
 * Crédits dus pour un coût observé, marge comprise, jamais moins que le plancher de
 * l'opération. Le plancher protège d'un appel qui coûterait trois centimes de dollar et
 * ne serait facturé zéro.
 */
export function creditsFor(costMicros: number, minimum: number, table: PricingTable): number {
  const withMargin = costMicros * table.multiplier
  return Math.max(minimum, Math.ceil(withMargin / table.microsPerCredit))
}
