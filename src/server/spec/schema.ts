import { z } from 'zod'
import { DENSITIES, FONT_IDS, PATTERNS } from '@/lib/fonts'
import { ICON_NAMES } from '@/lib/icons'

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
    /** Paire de polices, voir ./fonts.ts. */
    font: z.enum(FONT_IDS),
    mode: z.enum(['light', 'dark']),
    /** Motif décoratif des bandeaux. Facultatif : les applications d'avant en ont un par défaut. */
    pattern: z.enum(PATTERNS).optional(),
    /** Respiration des sections. Facultatif, équilibrée par défaut. */
    density: z.enum(DENSITIES).optional(),
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
  /**
   * Renvoi vers une fiche d'un autre modèle : une réservation qui désigne un client, une
   * ligne de devis qui désigne un produit. La valeur stockée est l'identifiant de la fiche
   * visée ; ce qui s'affiche est son nom, relu à la lecture.
   */
  'reference',
] as const

export const dataFieldSchema = z
  .object({
    id: slug,
    label: shortText,
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    /** Renseigné uniquement pour le type `select`. */
    options: z.array(shortText).max(30).optional(),
    /** Renseigné uniquement pour le type `reference` : le modèle vers lequel on renvoie. */
    referenceModelId: slug.optional(),
    help: shortText.optional(),
  })
  .strict()
  .refine(
    (field) => field.type !== 'select' || (field.options !== undefined && field.options.length > 0),
    { message: 'Un champ à choix multiples doit proposer au moins une option.' },
  )
  .refine((field) => field.type !== 'reference' || field.referenceModelId !== undefined, {
    message: 'Un renvoi doit dire vers quelles données il pointe.',
  })

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
    /**
     * Champ qui nomme une fiche, pour la désigner ailleurs — dans un renvoi, notamment.
     * À défaut, le premier champ texte du modèle. L'écrire évite de dépendre de l'ordre
     * des champs, qui n'a pas été pensé pour ça.
     */
    labelField: slug.optional(),
  })
  .strict()

// ───────────────────────────────── Blocs ─────────────────────────────────────

const blockBase = { id: slug }

const imageId = z.string().uuid()
const videoUrl = z
  .string()
  .max(300)
  .regex(
    /^https:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]{6,}|youtu\.be\/[\w-]{6,}|youtube\.com\/embed\/[\w-]{6,}|vimeo\.com\/\d{6,})/i,
    'Seules les vidéos YouTube et Vimeo sont acceptées.',
  )

export const heroBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('hero'),
    /** Petite mention au-dessus du titre : « Nouveau », « Depuis 2012 », un lieu. */
    eyebrow: shortText.optional(),
    title: shortText,
    subtitle: mediumText,
    ctaLabel: shortText.optional(),
    ctaPageId: slug.optional(),
    /**
     * Image, choisie par le créateur dans sa bibliothèque. Jamais renseignée par
     * l'assistant : il ne connaît aucun identifiant réel, et un identifiant inventé ne
     * renverrait rien. L'assemblage retire ce qu'il ne connaît pas.
     */
    imageId: imageId.optional(),
    /** centered : photo en fond. split : texte à gauche, image encadrée à droite. */
    layout: z.enum(['centered', 'split']).optional(),
  })
  .strict()

/** Image et texte côte à côte : la section la plus courante d'un site qui a de l'allure. */
export const imageTextBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('imageText'),
    title: shortText,
    body: longText,
    imageId: imageId.optional(),
    imagePosition: z.enum(['left', 'right']),
    ctaLabel: shortText.optional(),
    ctaPageId: slug.optional(),
  })
  .strict()

export const galleryBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('gallery'),
    title: shortText.optional(),
    items: z
      .array(z.object({ imageId: imageId.optional(), caption: shortText.optional() }).strict())
      .min(2)
      .max(12),
  })
  .strict()

/** Témoignages. Jamais inventés : l'assistant n'en ajoute que si le créateur les fournit. */
export const testimonialsBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('testimonials'),
    title: shortText.optional(),
    items: z
      .array(
        z
          .object({
            quote: mediumText,
            author: shortText,
            role: shortText.optional(),
            imageId: imageId.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()

export const stepsBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('steps'),
    title: shortText.optional(),
    items: z
      .array(z.object({ title: shortText, body: mediumText, icon: z.enum(ICON_NAMES).optional() }).strict())
      .min(2)
      .max(8),
  })
  .strict()

export const teamBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('team'),
    title: shortText.optional(),
    members: z
      .array(
        z
          .object({
            name: shortText,
            role: shortText,
            bio: mediumText.optional(),
            imageId: imageId.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()

/** Partenaires, clients, labels : des noms, éventuellement des logos téléversés. */
export const logosBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('logos'),
    title: shortText.optional(),
    items: z
      .array(z.object({ name: shortText, imageId: imageId.optional() }).strict())
      .min(2)
      .max(12),
  })
  .strict()

export const contactBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('contact'),
    title: shortText.optional(),
    body: mediumText.optional(),
    email: z.string().email().max(120).optional(),
    phone: z.string().min(6).max(30).optional(),
    address: mediumText.optional(),
    hours: mediumText.optional(),
  })
  .strict()

export const videoBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('video'),
    title: shortText.optional(),
    url: videoUrl,
    caption: mediumText.optional(),
  })
  .strict()

/** Tableau comparatif : des colonnes, des lignes, une valeur par case. */
export const comparisonBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('comparison'),
    title: shortText.optional(),
    columns: z.array(shortText).min(2).max(4),
    rows: z
      .array(z.object({ label: shortText, values: z.array(z.string().max(60)).min(2).max(4) }).strict())
      .min(1)
      .max(12),
  })
  .strict()

/** Bandeau d'annonce, fin, en haut ou en bas d'une page. */
export const bannerBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('banner'),
    text: mediumText,
    label: shortText.optional(),
    pageId: slug.optional(),
    href: externalLink.optional(),
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
    intro: mediumText.optional(),
    items: z
      .array(
        z
          .object({ title: shortText, body: mediumText, icon: z.enum(ICON_NAMES).optional() })
          .strict(),
      )
      .min(1)
      .max(9),
    /** cards : grille de cartes. list : une colonne, icône à gauche. */
    layout: z.enum(['cards', 'list']).optional(),
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
    /**
     * Corriger ce qu'on a saisi. Par défaut oui : une application où l'on peut créer et
     * détruire mais jamais rectifier oblige à supprimer pour changer une virgule.
     * La valeur par défaut vaut aussi pour les applications publiées avant cette
     * fonction, dont la spécification figée ne porte pas ce champ.
     */
    allowEdit: z.boolean().default(true),
    /**
     * Une barre de recherche au-dessus de la liste. Par défaut oui, mais l'écran ne
     * l'affiche qu'à partir de quelques fiches : chercher parmi trois éléments est une
     * question qu'on ne se pose pas.
     */
    searchable: z.boolean().default(true),
    /**
     * Champ à choix sur lequel proposer un filtre — un statut, une catégorie. Il doit
     * exister dans le modèle et être de type `select` : sur du texte libre, aucune valeur
     * ne se répéterait assez pour faire un filtre utile.
     */
    filterField: slug.optional(),
    /** Ordre d'ouverture de la liste. Le visiteur peut en changer. */
    sort: z.enum(['recent', 'ancien', 'az', 'za']).default('recent'),
    /**
     * Champ numérique dont la liste annonce le total. Il porte sur ce qui est affiché :
     * filtrer la liste change le total, ce qui est le seul comportement qui ne ment pas.
     */
    sumField: slug.optional(),
    sumKind: z.enum(['somme', 'moyenne']).default('somme'),
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

export const BLOCK_SCHEMAS = {
  hero: heroBlockSchema,
  richText: richTextBlockSchema,
  imageText: imageTextBlockSchema,
  features: featuresBlockSchema,
  steps: stepsBlockSchema,
  gallery: galleryBlockSchema,
  testimonials: testimonialsBlockSchema,
  team: teamBlockSchema,
  logos: logosBlockSchema,
  faq: faqBlockSchema,
  stats: statsBlockSchema,
  comparison: comparisonBlockSchema,
  video: videoBlockSchema,
  contact: contactBlockSchema,
  banner: bannerBlockSchema,
  cta: ctaBlockSchema,
  pricing: pricingBlockSchema,
  recordForm: recordFormBlockSchema,
  recordList: recordListBlockSchema,
  auth: authBlockSchema,
  assistant: assistantBlockSchema,
} as const

export const blockSchema = z.discriminatedUnion('type', [
  heroBlockSchema,
  richTextBlockSchema,
  imageTextBlockSchema,
  featuresBlockSchema,
  stepsBlockSchema,
  galleryBlockSchema,
  testimonialsBlockSchema,
  teamBlockSchema,
  logosBlockSchema,
  faqBlockSchema,
  statsBlockSchema,
  comparisonBlockSchema,
  videoBlockSchema,
  contactBlockSchema,
  bannerBlockSchema,
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
  'imageText',
  'features',
  'steps',
  'gallery',
  'testimonials',
  'team',
  'logos',
  'faq',
  'stats',
  'comparison',
  'video',
  'contact',
  'banner',
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
