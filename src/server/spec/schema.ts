import { z } from 'zod'

/**
 * AppSpec — description déclarative d'une application créée sur la plateforme.
 *
 * C'est la source de vérité du produit. L'IA ne produit que cela ; les compilateurs
 * (web aujourd'hui, projet exportable et mobile ensuite) ne consomment que cela.
 *
 * Trois règles tiennent tout le reste :
 *   1. Schéma fermé. Aucune propriété inconnue n'est acceptée.
 *   2. Aucun secret. Une AppSpec est servie au navigateur ; y stocker une clé serait
 *      la publier. Les valeurs sensibles vivent dans des tables dédiées.
 *   3. Aucun code. Pas de HTML, pas de script, pas d'URL arbitraire.
 *
 * Voir docs/01-analyse-et-stack.md et docs/04-isolation-multi-tenant.md.
 */

export const SPEC_VERSION = 1

const slug = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/, 'Identifiant invalide : minuscules, chiffres et tirets.')

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide : format attendu #RRGGBB.')

const shortText = z.string().min(1).max(120)
const mediumText = z.string().min(1).max(400)
const longText = z.string().min(1).max(4000)

/** Lien externe : uniquement https et mailto. Interdit javascript:, data:, file:. */
const externalLink = z
  .string()
  .max(400)
  .refine(
    (value) => /^https:\/\//i.test(value) || /^mailto:[^\s@]+@[^\s@]+$/i.test(value),
    'Seuls les liens https et mailto sont autorisés.',
  )

// ───────────────────────────────── Thème ─────────────────────────────────────

export const themeSchema = z
  .object({
    colors: z
      .object({
        primary: hexColor,
        accent: hexColor,
        background: hexColor,
        surface: hexColor,
        text: hexColor,
        muted: hexColor,
      })
      .strict(),
    radius: z.enum(['none', 'small', 'medium', 'large']),
    font: z.enum(['system', 'serif', 'rounded']),
    mode: z.enum(['light', 'dark']),
  })
  .strict()

// ──────────────────────────── Modèles de données ─────────────────────────────

export const FIELD_TYPES = [
  'text',
  'longText',
  'number',
  'boolean',
  'date',
  'email',
  'url',
  'select',
] as const

export const dataFieldSchema = z
  .object({
    id: slug,
    label: shortText,
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    /** Renseigné uniquement pour le type `select`. */
    options: z.array(shortText).max(30).optional(),
    help: shortText.optional(),
  })
  .strict()
  .refine(
    (field) => field.type !== 'select' || (field.options !== undefined && field.options.length > 0),
    { message: 'Un champ à choix multiples doit proposer au moins une option.' },
  )

export const dataModelSchema = z
  .object({
    id: slug,
    label: shortText,
    labelPlural: shortText,
    /**
     * `user`  : chaque utilisateur final ne voit que ses propres enregistrements.
     * `shared`: tout le monde voit tout (annuaire, catalogue public).
     */
    scope: z.enum(['user', 'shared']),
    fields: z.array(dataFieldSchema).min(1).max(20),
  })
  .strict()

// ───────────────────────────────── Blocs ─────────────────────────────────────

const blockBase = { id: slug }

export const heroBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('hero'),
    title: shortText,
    subtitle: mediumText,
    ctaLabel: shortText.optional(),
    ctaPageId: slug.optional(),
  })
  .strict()

export const richTextBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('richText'),
    title: shortText.optional(),
    body: longText,
  })
  .strict()

export const featuresBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('features'),
    title: shortText.optional(),
    items: z
      .array(z.object({ title: shortText, body: mediumText }).strict())
      .min(1)
      .max(9),
  })
  .strict()

export const faqBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('faq'),
    title: shortText.optional(),
    items: z
      .array(z.object({ question: shortText, answer: mediumText }).strict())
      .min(1)
      .max(15),
  })
  .strict()

export const statsBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('stats'),
    items: z
      .array(z.object({ label: shortText, value: shortText }).strict())
      .min(1)
      .max(6),
  })
  .strict()

export const ctaBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('cta'),
    title: shortText,
    body: mediumText.optional(),
    label: shortText,
    pageId: slug.optional(),
    href: externalLink.optional(),
  })
  .strict()

export const pricingBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('pricing'),
    title: shortText.optional(),
    note: mediumText.optional(),
  })
  .strict()

/** Formulaire qui enregistre réellement des données côté serveur. */
export const recordFormBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('recordForm'),
    title: shortText.optional(),
    modelId: slug,
    submitLabel: shortText,
    successMessage: mediumText,
  })
  .strict()

/** Liste alimentée par les données enregistrées. */
export const recordListBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('recordList'),
    title: shortText.optional(),
    modelId: slug,
    titleField: slug,
    subtitleField: slug.optional(),
    emptyText: mediumText,
    allowDelete: z.boolean(),
  })
  .strict()

/** Connexion et inscription des utilisateurs finaux de l'application créée. */
export const authBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('auth'),
    title: shortText,
    body: mediumText.optional(),
  })
  .strict()

/**
 * Assistant conversationnel intégré à l'application créée.
 *
 * Le créateur décrit le rôle confié à l'assistant ; ce texte devient une consigne, jamais
 * du code. Les questions des visiteurs sont traitées comme des données non fiables, et
 * chaque réponse est débitée des crédits du créateur, pas de ceux de la plateforme.
 */
export const assistantBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('assistant'),
    title: shortText,
    intro: mediumText.optional(),
    /** Rôle et périmètre de l'assistant, écrits par le créateur. */
    role: z.string().min(20).max(2000),
    placeholder: shortText,
  })
  .strict()

export const blockSchema = z.discriminatedUnion('type', [
  heroBlockSchema,
  richTextBlockSchema,
  featuresBlockSchema,
  faqBlockSchema,
  statsBlockSchema,
  ctaBlockSchema,
  pricingBlockSchema,
  recordFormBlockSchema,
  recordListBlockSchema,
  authBlockSchema,
  assistantBlockSchema,
])

export const BLOCK_TYPES = [
  'hero',
  'richText',
  'features',
  'faq',
  'stats',
  'cta',
  'pricing',
  'recordForm',
  'recordList',
  'auth',
  'assistant',
] as const

export type BlockType = (typeof BLOCK_TYPES)[number]

// ───────────────────────────────── Pages ─────────────────────────────────────

export const pageSchema = z
  .object({
    id: slug,
    title: shortText,
    /** Chemin relatif dans l'application publiée. `accueil` est la page d'entrée. */
    path: slug,
    requiresAuth: z.boolean(),
    blocks: z.array(blockSchema).min(1).max(20),
  })
  .strict()

export const navigationSchema = z
  .object({
    style: z.enum(['topbar', 'tabs']),
    items: z
      .array(z.object({ pageId: slug, label: shortText }).strict())
      .min(1)
      .max(7),
  })
  .strict()

// ───────────────────────────── Monétisation ──────────────────────────────────

export const planSchema = z
  .object({
    id: slug,
    name: shortText,
    priceCents: z.number().int().min(0).max(1_000_000),
    interval: z.enum(['once', 'month', 'year']),
    features: z.array(shortText).min(1).max(8),
    highlighted: z.boolean(),
  })
  .strict()

export const monetizationSchema = z
  .object({
    model: z.enum(['free', 'one_time', 'subscription', 'freemium', 'credits']),
    currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']),
    plans: z.array(planSchema).max(4),
    /** Potentiel de monétisation, jamais une promesse de revenus (exigence 22). */
    note: mediumText.optional(),
  })
  .strict()

export const appAuthSchema = z
  .object({
    enabled: z.boolean(),
    allowSignup: z.boolean(),
  })
  .strict()

// ──────────────────────────────── AppSpec ────────────────────────────────────

export const appSpecSchema = z
  .object({
    specVersion: z.literal(SPEC_VERSION),
    name: shortText,
    tagline: mediumText,
    description: longText,
    locale: z.enum(['fr', 'en', 'de', 'it', 'es']),
    theme: themeSchema,
    auth: appAuthSchema,
    dataModels: z.array(dataModelSchema).max(8),
    pages: z.array(pageSchema).min(1).max(12),
    navigation: navigationSchema,
    monetization: monetizationSchema,
  })
  .strict()

export type AppSpec = z.infer<typeof appSpecSchema>
export type Page = z.infer<typeof pageSchema>
export type Block = z.infer<typeof blockSchema>
export type DataModel = z.infer<typeof dataModelSchema>
export type DataField = z.infer<typeof dataFieldSchema>
export type Theme = z.infer<typeof themeSchema>
export type Monetization = z.infer<typeof monetizationSchema>
