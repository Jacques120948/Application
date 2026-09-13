import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { requireOwnedProject, withRuntimeScope, withUserScope } from '@/server/db/scope'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { isEnabled } from '@/server/settings/flags'
import { logger } from '@/server/observability/logger'

/**
 * Réglages de Lia, par application.
 *
 * Lia est éteinte par défaut : le créateur l'allume quand sa base de connaissances est
 * prête, et il peut l'éteindre à tout moment. L'allumer exige que le module soit ouvert
 * sur l'installation (drapeau) et inclus dans son offre ; l'éteindre n'exige rien — on ne
 * garde jamais une personne dans une fonction qu'elle ne veut plus.
 */

export const LIA_FEATURE = 'lia_support'
export const POSITIONS = ['bottom-right', 'bottom-left'] as const

export const settingsInput = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
  greeting: z.string().trim().min(1).max(300).optional(),
  position: z.enum(POSITIONS).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  escalationEmail: z.string().trim().email().max(200).nullable().optional(),
  retentionDays: z.number().int().min(7).max(365).optional(),
})

export type SettingsInput = z.infer<typeof settingsInput>

export type SupportSettingsView = {
  enabled: boolean
  displayName: string
  greeting: string
  position: (typeof POSITIONS)[number]
  accentColor: string | null
  escalationEmail: string | null
  retentionDays: number
}

/** Ce que le widget public a le droit de connaître. Rien d'autre ne sort. */
export type PublicSupportSettings = Pick<
  SupportSettingsView,
  'enabled' | 'displayName' | 'greeting' | 'position' | 'accentColor'
>

type Row = {
  enabled: boolean
  displayName: string
  greeting: string
  position: string
  accentColor: string | null
  escalationEmail: string | null
  retentionDays: number
}

function toView(row: Row): SupportSettingsView {
  return {
    enabled: row.enabled,
    displayName: row.displayName,
    greeting: row.greeting,
    position: row.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    accentColor: row.accentColor,
    escalationEmail: row.escalationEmail,
    retentionDays: row.retentionDays,
  }
}

/** Le module est-il ouvert à cette personne ? Lève la même erreur que les autres modules. */
export async function assertLiaOpen(userId: string): Promise<void> {
  if (!(await isEnabled('liaSupport'))) {
    throw new AppError('UNSUPPORTED_REQUEST', "L'assistante support n'est pas ouverte sur cette installation.")
  }
  requireFeature(await getEntitlements(userId), LIA_FEATURE)
}

/** Ouvert (drapeau et offre), verrouillé par l'offre, ou fermé sur l'installation. */
export async function liaAccess(userId: string): Promise<{ state: 'open' | 'locked' | 'closed'; availableWith: string | null }> {
  if (!(await isEnabled('liaSupport'))) return { state: 'closed', availableWith: null }
  const entitlements = await getEntitlements(userId)
  if (entitlements.granted.includes(LIA_FEATURE)) return { state: 'open', availableWith: null }
  const lock = entitlements.locked.find((entry) => entry.feature.id === LIA_FEATURE)
  return { state: 'locked', availableWith: lock?.availableWith ?? null }
}

/** Lit les réglages du créateur, en les créant s'ils n'existent pas encore. */
export async function getSupportSettings(ownerId: string, projectId: string): Promise<SupportSettingsView> {
  return withUserScope(ownerId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    const existing = await tx.supportSettings.findUnique({ where: { projectId } })
    if (existing !== null) return toView(existing)
    return toView(await tx.supportSettings.create({ data: { userId: ownerId, projectId } }))
  })
}

export async function updateSupportSettings(
  ownerId: string,
  projectId: string,
  input: SettingsInput,
): Promise<SupportSettingsView> {
  if (input.enabled === true) await assertLiaOpen(ownerId)
  await getSupportSettings(ownerId, projectId)
  const data: Record<string, unknown> = {}
  for (const key of ['enabled', 'displayName', 'greeting', 'position', 'accentColor', 'escalationEmail', 'retentionDays'] as const) {
    if (input[key] !== undefined) data[key] = input[key]
  }
  const updated = await withUserScope(ownerId, (tx) =>
    tx.supportSettings.update({ where: { projectId }, data }),
  )
  logger.info('lia : réglages modifiés', { userId: ownerId, projectId, enabled: updated.enabled })
  return toView(updated)
}

/**
 * Les réglages vus depuis l'application servie. Sans réglages, Lia n'existe pas ; sans
 * drapeau non plus — éteindre le module éteint tous les widgets d'un coup.
 */
export async function readPublicSupportSettings(projectId: string): Promise<PublicSupportSettings | null> {
  if (!(await isEnabled('liaSupport'))) return null
  const row = await withRuntimeScope(projectId, (tx) =>
    tx.supportSettings.findUnique({
      where: { projectId },
      select: { enabled: true, displayName: true, greeting: true, position: true, accentColor: true },
    }),
  )
  if (row === null || !row.enabled) return null
  const view = toView({ ...row, escalationEmail: null, retentionDays: 0 })
  return {
    enabled: view.enabled,
    displayName: view.displayName,
    greeting: view.greeting,
    position: view.position,
    accentColor: view.accentColor,
  }
}
