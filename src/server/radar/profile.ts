import { z } from 'zod'
import { withUserScope } from '@/server/db/scope'
import { requireProfile } from '@/server/business/profile'
import type { RadarProfileInput } from '@/server/ai/operations'

/**
 * Le profil vu par le Radar.
 *
 * Rien n'est redemandé : l'objectif, le temps, le budget, les compétences, le secteur et
 * la clientèle viennent du profil déjà rempli au début du parcours. Le Radar y ajoute sept
 * précisions, toutes facultatives, qui affinent sans conditionner. Une personne qui n'en
 * renseigne aucune reçoit des opportunités valables — seulement moins fines, et l'écran le
 * lui dit en lui proposant d'améliorer ses recommandations.
 *
 * Aucune de ces précisions n'est sensible : un niveau technique, une envie ou non de
 * prospecter, une étendue de marché. On ne construit pas de portrait, on règle un filtre.
 */

export const TECHNICAL_LEVELS = ['debutant', 'intermediaire', 'avance'] as const
export const ENTREPRENEUR_EXPERIENCES = ['aucune', 'premiere', 'confirmee'] as const
export const MARKET_SCOPES = ['local', 'francophone', 'international'] as const
export const PRODUCT_PREFERENCES = [
  'saas',
  'application',
  'outil_metier',
  'marketplace',
  'indifferent',
] as const

export const radarProfileInput = z.object({
  experienceYears: z.number().int().min(0).max(60).nullable().optional(),
  knownSectors: z.string().trim().max(300).optional(),
  technicalLevel: z.enum(TECHNICAL_LEVELS).optional(),
  entrepreneurExperience: z.enum(ENTREPRENEUR_EXPERIENCES).optional(),
  marketScope: z.enum(MARKET_SCOPES).optional(),
  productPreference: z.enum(PRODUCT_PREFERENCES).optional(),
  willingToProspect: z.boolean().nullable().optional(),
})

export type RadarProfileUpdate = z.infer<typeof radarProfileInput>

/** Une ligne de CreatorProfile, telle que Prisma la renvoie, réduite à ce qu'on lit ici. */
export type ProfileRow = {
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
  experienceYears: number | null
  knownSectors: string
  technicalLevel: string
  entrepreneurExperience: string
  marketScope: string
  productPreference: string
  willingToProspect: boolean | null
}

/** Ce que le modèle reçoit. Rien de plus que ce qui sert à recommander. */
export function toRadarProfile(profile: ProfileRow): RadarProfileInput {
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
    experienceYears: profile.experienceYears,
    knownSectors: profile.knownSectors,
    technicalLevel: profile.technicalLevel,
    entrepreneurExperience: profile.entrepreneurExperience,
    marketScope: profile.marketScope,
    productPreference: profile.productPreference,
    willingToProspect: profile.willingToProspect,
  }
}

/**
 * Les précisions encore vides, pour l'écran « Améliorer mes recommandations ».
 *
 * On ne compte que ce qui n'a jamais été renseigné. Un choix explicite — même « je ne sais
 * pas » — n'est pas un manque.
 */
export function missingPrecisions(profile: ProfileRow): string[] {
  const manquantes: string[] = []
  if (profile.experienceYears === null) manquantes.push('experienceYears')
  if (profile.knownSectors.trim() === '') manquantes.push('knownSectors')
  if (profile.willingToProspect === null) manquantes.push('willingToProspect')
  return manquantes
}

/** Le profil complet, tel que le Radar le lit. Exige un profil de base terminé. */
export async function readRadarProfile(userId: string): Promise<ProfileRow> {
  return requireProfile(userId)
}

/** Enregistre les précisions facultatives. Ne touche à rien d'autre du profil. */
export async function improveProfile(
  userId: string,
  input: RadarProfileUpdate,
): Promise<ProfileRow> {
  await requireProfile(userId)
  const data: Record<string, unknown> = {}
  if (input.experienceYears !== undefined) data.experienceYears = input.experienceYears
  if (input.knownSectors !== undefined) data.knownSectors = input.knownSectors
  if (input.technicalLevel !== undefined) data.technicalLevel = input.technicalLevel
  if (input.entrepreneurExperience !== undefined) {
    data.entrepreneurExperience = input.entrepreneurExperience
  }
  if (input.marketScope !== undefined) data.marketScope = input.marketScope
  if (input.productPreference !== undefined) data.productPreference = input.productPreference
  if (input.willingToProspect !== undefined) data.willingToProspect = input.willingToProspect

  return withUserScope(userId, (tx) =>
    tx.creatorProfile.update({ where: { userId }, data }),
  )
}
