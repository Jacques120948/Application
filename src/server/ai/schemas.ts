import { z } from 'zod'
import { TEMPLATE_KINDS } from '@/server/spec/templates'
import {
  BLOCK_TYPES,
  blockSchema,
  dataModelSchema,
  monetizationSchema,
  navigationSchema,
  themeSchema,
} from '@/server/spec/schema'

/**
 * Contrats de sortie de l'assistant.
 *
 * Chaque schéma sert deux fois : il contraint la réponse du modèle (sorties structurées)
 * et il type le résultat côté TypeScript. Une réponse non conforme n'atteint jamais la
 * base de données.
 */

export const blueprintSchema = z
  .object({
    /** Faux si l'idée sort du champ de ce que la plateforme sait construire. */
    feasible: z.boolean(),
    appName: z.string().min(1).max(60),
    tagline: z.string().min(1).max(160),
    concept: z.string().min(1).max(600),
    description: z.string().min(1).max(1500),
    features: z
      .array(z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(300) }))
      .min(2)
      .max(8),
    monetization: z
      .array(
        z.object({
          model: z.enum(['free', 'one_time', 'subscription', 'freemium', 'credits']),
          label: z.string().min(1).max(80),
          rationale: z.string().min(1).max(300),
        }),
      )
      .min(1)
      .max(4),
    templateKind: z.enum(TEMPLATE_KINDS),
    themePreset: z.enum(['confiance', 'nature', 'chaleur', 'elegance']),
    /** Ce que la plateforme ne sait pas faire pour cette idée. Dit franchement. */
    limitations: z.array(z.string().min(1).max(200)).max(5),
  })
  .strict()

export type Blueprint = z.infer<typeof blueprintSchema>

/** Échelle commune à tous les indicateurs qualitatifs, pour rester comparable. */
export const LEVELS = ['faible', 'moyen', 'fort'] as const

export const BUSINESS_MODELS = ['one_time', 'subscription', 'freemium', 'credits'] as const
export const PRICE_INTERVALS = ['once', 'month', 'year'] as const

/**
 * Idée proposée au créateur.
 *
 * Les grandeurs commerciales sont des **nombres**, pas des phrases : c'est ce qui permet
 * de comparer deux idées et d'en déduire un nombre de clients. Le modèle ne calcule jamais
 * ce nombre lui-même — c'est la plateforme qui le fait, à partir du prix et de l'objectif
 * (voir server/business/economics.ts).
 */
export const ideaSuggestionSchema = z
  .object({
    title: z.string().min(1).max(80),
    problem: z.string().min(1).max(400),
    audience: z.string().min(1).max(200),
    valueProposition: z.string().min(1).max(300),
    features: z.array(z.string().min(1).max(120)).min(3).max(6),
    businessModel: z.enum(BUSINESS_MODELS),
    /** Prix conseillé, en centimes. */
    recommendedPriceCents: z.number().int().min(0).max(500_000),
    priceInterval: z.enum(PRICE_INTERVALS),
    /** Note d'opportunité globale, de 0 à 100. */
    opportunityScore: z.number().int().min(0).max(100),
    demandLevel: z.enum(LEVELS),
    competitionLevel: z.enum(LEVELS),
    complexityLevel: z.enum(LEVELS),
    operatingCostLevel: z.enum(LEVELS),
    /** Délai réaliste avant une première version présentable, en semaines. */
    timeToMarketWeeks: z.number().int().min(1).max(26),
    risks: z.array(z.string().min(1).max(200)).min(1).max(3),
    differentiators: z.array(z.string().min(1).max(200)).min(1).max(3),
  })
  .strict()

export type IdeaSuggestion = z.infer<typeof ideaSuggestionSchema>

export const ideasSchema = z
  .object({ ideas: z.array(ideaSuggestionSchema).min(3).max(5) })
  .strict()

export type Ideas = z.infer<typeof ideasSchema>

/**
 * Rapport de validation d'une idée choisie.
 *
 * Objectif : éviter de construire à l'aveugle. Le rapport doit pouvoir conclure
 * « à éviter » — une validation qui valide toujours ne sert à rien.
 */
export const validationSchema = z
  .object({
    opportunityScore: z.number().int().min(0).max(100),
    demandLevel: z.enum(LEVELS),
    competitionLevel: z.enum(LEVELS),
    complexityLevel: z.enum(LEVELS),
    operatingCostLevel: z.enum(LEVELS),
    marketSize: z.string().min(1).max(300),
    problemAssessment: z.string().min(1).max(500),
    audienceAssessment: z.string().min(1).max(400),
    competitors: z
      .array(z.object({ name: z.string().min(1).max(80), note: z.string().min(1).max(240) }).strict())
      .max(4),
    essentialFeatures: z.array(z.string().min(1).max(120)).min(3).max(6),
    featuresToAvoid: z.array(z.string().min(1).max(120)).max(4),
    businessModel: z.enum(BUSINESS_MODELS),
    recommendedPriceCents: z.number().int().min(0).max(500_000),
    priceInterval: z.enum(PRICE_INTERVALS),
    pricingRationale: z.string().min(1).max(400),
    acquisitionDifficulty: z.enum(LEVELS),
    acquisitionChannels: z.array(z.string().min(1).max(160)).min(2).max(4),
    risks: z
      .array(
        z
          .object({
            risk: z.string().min(1).max(240),
            mitigation: z.string().min(1).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    differentiators: z.array(z.string().min(1).max(200)).min(1).max(3),
    /** Transparence (exigence 29) : ce qui dépendra d'un tiers, et si c'est payant. */
    externalServices: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            why: z.string().min(1).max(200),
            paid: z.boolean(),
          })
          .strict(),
      )
      .max(4),
    verdict: z.enum(['a-lancer', 'a-ajuster', 'a-eviter']),
    verdictReason: z.string().min(1).max(500),
  })
  .strict()

export type IdeaValidation = z.infer<typeof validationSchema>

/**
 * Réponse de l'assistant à une demande de modification.
 *
 * `valueJson` porte la nouvelle valeur **encodée en JSON dans une chaîne**, et non comme
 * une valeur libre. Raison mesurée contre l'API : un champ sans type déclaré (`unknown`)
 * est refusé par la compilation de grammaire des sorties structurées. Une chaîne est
 * typable, et la valeur qu'elle contient est de toute façon revalidée par le schéma
 * AppSpec après application du patch — la sécurité ne repose pas sur ce champ.
 *
 * Tous les champs sont obligatoires : `index`, `from` et `to` valent 0 quand l'opération
 * ne les utilise pas, `valueJson` vaut "null".
 */
export const editResponseSchema = z
  .object({
    /** Faux quand la demande sort du vocabulaire de la plateforme. */
    supported: z.boolean(),
    /** Message adressé à l'utilisateur, en langage courant, sans jargon. */
    reply: z.string().min(1).max(600),
    summary: z.string().min(1).max(120),
    operations: z
      .array(
        z
          .object({
            op: z.enum(['set', 'delete', 'append', 'insert', 'move']),
            path: z.string().min(1).max(300),
            valueJson: z.string().max(20_000),
            index: z.number().int().min(0).max(200),
            from: z.number().int().min(0).max(200),
            to: z.number().int().min(0).max(200),
          })
          .strict(),
      )
      .max(40),
  })
  .strict()

export type EditResponse = z.infer<typeof editResponseSchema>

/**
 * Génération en deux temps.
 *
 * L'API compile les sorties structurées en grammaire, et cette grammaire a une taille
 * maximale. Mesuré contre l'API réelle : l'union des dix types de section passe sans
 * problème dans `{ blocks: [...] }`, mais la même union imbriquée un niveau plus bas,
 * dans `{ pages: [ { blocks: [...] } ] }`, dépasse la limite et l'appel est refusé.
 *
 * D'où deux contrats :
 *   1. `appPlanSchema`   — tout sauf le contenu des pages (un seul appel) ;
 *   2. `pageContentSchema` — les sections d'UNE page (un appel par page, en parallèle).
 *
 * Effet de bord bienvenu : une page qui échoue ne fait pas perdre toute l'application,
 * et le prompt système commun reste identique d'un appel à l'autre, donc mis en cache.
 */
export const appPlanSchema = z
  .object({
    name: z.string().min(1).max(120),
    tagline: z.string().min(1).max(400),
    description: z.string().min(1).max(4000),
    locale: z.enum(['fr', 'en', 'de', 'it', 'es']),
    theme: themeSchema,
    auth: z.object({ enabled: z.boolean(), allowSignup: z.boolean() }).strict(),
    dataModels: z.array(dataModelSchema).max(8),
    pages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(48),
            title: z.string().min(1).max(120),
            path: z.string().min(1).max(48),
            requiresAuth: z.boolean(),
            /** Sections attendues sur cette page, dans l'ordre. */
            blockTypes: z.array(z.enum(BLOCK_TYPES)).min(1).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    navigation: navigationSchema,
    monetization: monetizationSchema,
  })
  .strict()

export type AppPlan = z.infer<typeof appPlanSchema>

export const pageContentSchema = z.object({ blocks: z.array(blockSchema).min(1).max(10) }).strict()

export type PageContent = z.infer<typeof pageContentSchema>
