import { z } from 'zod'

/**
 * Forme des échanges avec le moteur social.
 *
 * Ces types décrivent une frontière entre deux services : ils sont écrits des deux côtés,
 * parce que deux dépôts séparés ne partagent pas de code — c'est le prix, assumé, de garder
 * Postelya indépendant. Ce n'est pas une duplication du moteur : les prompts, les règles
 * d'écriture et la taxonomie des angles n'existent qu'à un seul endroit, chez Postelya.
 *
 * Le schéma sert à vérifier ce qui revient. Un moteur qui change de forme sans prévenir doit
 * produire une erreur nette, pas un écran à moitié rempli.
 */

export const ANGLE_KEYS = [
  'PROBLEM_SOLUTION',
  'EMOTION',
  'SOCIAL_PROOF',
  'CURIOSITY',
  'GIFT',
  'URGENCY',
  'BEHIND_THE_SCENES',
  'EXPERTISE',
  'STORYTELLING',
  'TRANSFORMATION',
] as const

export const OBJECTIVE_KEYS = ['AWARENESS', 'ENGAGEMENT', 'TRAFFIC', 'SALES', 'COMMUNITY'] as const

export const FORMATS = ['POST', 'CAROUSEL', 'REEL', 'STORY'] as const

export type BrandContext = {
  name: string
  tagline: string
  description: string
  problem: string
  audience: string
  valueProposition: string
  features: string[]
  differentiators: string[]
  priceLabel: string | null
  website: string | null
  sector: string | null
  voice: { tone: string[]; forbidden: string[]; keywords: string[] }
  locale: 'fr' | 'en' | 'de' | 'it' | 'es'
}

export const angleSchema = z.object({
  key: z.enum(ANGLE_KEYS),
  title: z.string().min(1).max(120),
  promise: z.string().min(1).max(400),
  example: z.string().min(1).max(400),
})

export const ideaSchema = z.object({
  title: z.string().min(1).max(200),
  angleKey: z.enum(ANGLE_KEYS),
  format: z.enum(FORMATS),
  hook: z.string().min(1).max(400),
  description: z.string().min(1).max(800),
  visual: z.string().min(1).max(400),
})

export const scheduledPostSchema = z.object({
  day: z.number().int().min(0).max(6),
  time: z.string().min(1).max(10),
  angleKey: z.enum(ANGLE_KEYS),
  objective: z.enum(OBJECTIVE_KEYS),
  format: z.enum(FORMATS),
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().max(60)).max(30),
  cta: z.string().max(200),
})

export const launchKitSchema = z.object({
  benefits: z.array(z.string().max(300)).min(1).max(8),
  valueProposition: z.string().min(1).max(400),
  angles: z.array(angleSchema).min(1).max(8),
  ideas: z.array(ideaSchema).min(1).max(14),
  week: z.array(scheduledPostSchema).min(1).max(10),
  ctas: z.array(z.string().max(200)).min(1).max(8),
})

export type MarketingAngle = z.infer<typeof angleSchema>
export type ContentIdea = z.infer<typeof ideaSchema>
export type ScheduledPost = z.infer<typeof scheduledPostSchema>
export type LaunchKit = z.infer<typeof launchKitSchema>

export const ANGLE_FAMILY_LABEL: Record<(typeof ANGLE_KEYS)[number], string> = {
  PROBLEM_SOLUTION: 'Problème → solution',
  EMOTION: 'Émotion',
  SOCIAL_PROOF: 'Preuve sociale',
  CURIOSITY: 'Curiosité',
  GIFT: 'Idée cadeau',
  URGENCY: 'Urgence',
  BEHIND_THE_SCENES: 'Coulisses',
  EXPERTISE: 'Expertise',
  STORYTELLING: 'Histoire',
  TRANSFORMATION: 'Avant → après',
}

export const OBJECTIVE_LABEL: Record<(typeof OBJECTIVE_KEYS)[number], string> = {
  AWARENESS: 'Notoriété',
  ENGAGEMENT: 'Engagement',
  TRAFFIC: 'Trafic',
  SALES: 'Ventes',
  COMMUNITY: 'Communauté',
}

export const FORMAT_LABEL: Record<(typeof FORMATS)[number], string> = {
  POST: 'Publication',
  CAROUSEL: 'Carrousel',
  REEL: 'Vidéo courte',
  STORY: 'Story',
}

export const DAY_LABEL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
