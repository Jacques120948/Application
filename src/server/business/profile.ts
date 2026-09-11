import { z } from 'zod'
import { AppError, notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import type { CreatorProfileInput } from '@/server/ai/operations'
import { OBJECTIVE_PRESETS_CENTS, SUPPORTED_CURRENCIES } from './economics'

/**
 * Profil du créateur : la première chose que la plateforme apprend de lui.
 *
 * C'est ce qui distingue le produit d'un générateur d'applications. On ne demande pas
 * « que voulez-vous construire ? » mais « où voulez-vous aller, et avec quoi ? ».
 */

export const profileInput = z.object({
  monthlyGoalCents: z
    .number()
    .int()
    .min(5_000, 'Indiquez un objectif mensuel réaliste.')
    .max(5_000_000),
  weeklyHours: z.number().int().min(1).max(80),
  budgetCents: z.number().int().min(0).max(1_000_000),
  /**
   * Monnaie du parcours. Elle est choisie, jamais déduite du pays : quelqu'un peut vivre
   * en Suisse et vouloir vendre en euros.
   */
  currency: z.enum(SUPPORTED_CURRENCIES).default('EUR'),
  country: z.string().trim().min(1).max(60).default('France'),
  skills: z.string().trim().max(400).default(''),
  interests: z.string().trim().max(400).default(''),
  sector: z.string().trim().max(200).default(''),
  audience: z.enum(['particuliers', 'professionnels', 'les-deux']),
  ambition: z.enum(['simple', 'ambitieux']),
  preferredModel: z.enum(['subscription', 'one_time', 'freemium', 'indifferent']),
})

export type ProfileInput = z.infer<typeof profileInput>

export const OBJECTIVE_CHOICES = OBJECTIVE_PRESETS_CENTS

export async function saveProfile(userId: string, input: ProfileInput) {
  return withUserScope(userId, (tx) =>
    tx.creatorProfile.upsert({
      where: { userId },
      create: { userId, ...input, completedAt: new Date() },
      update: { ...input, completedAt: new Date() },
    }),
  )
}

export async function getProfile(userId: string) {
  return withUserScope(userId, (tx) => tx.creatorProfile.findUnique({ where: { userId } }))
}

/** Le parcours guidé n'a aucun sens sans profil : on le réclame explicitement. */
export async function requireProfile(userId: string) {
  const profile = await getProfile(userId)
  if (profile === null || profile.completedAt === null) {
    throw new AppError(
      'VALIDATION',
      "Commencez par définir votre objectif : c'est ce qui guide toutes les propositions.",
    )
  }
  return profile
}

export function toAssistantProfile(profile: {
  monthlyGoalCents: number
  weeklyHours: number
  budgetCents: number
  currency: string
  country: string
  skills: string
  interests: string
  sector: string
  audience: string
  ambition: string
  preferredModel: string
}): CreatorProfileInput {
  return {
    monthlyGoalCents: profile.monthlyGoalCents,
    weeklyHours: profile.weeklyHours,
    budgetCents: profile.budgetCents,
    currency: profile.currency,
    country: profile.country,
    skills: profile.skills,
    interests: profile.interests,
    sector: profile.sector,
    audience: profile.audience,
    ambition: profile.ambition,
    preferredModel: profile.preferredModel,
  }
}

export async function requireProfileOrNotFound(userId: string) {
  const profile = await getProfile(userId)
  if (profile === null) throw notFound('Profil introuvable.')
  return profile
}
