import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { Prisma, ProjectStatus } from '@prisma/client'
import { AppError, conflict, notFound, validation } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import { prisma } from '@/server/db/client'
import { requireOwnedProject, withUserScope, type TenantClient } from '@/server/db/scope'
import { getEffectivePlan } from '@/server/billing/plans'
import { isAiAvailable } from '@/server/ai/client'
import { generateBlueprint, generateSpec, requestEdit } from '@/server/ai/operations'
import { blueprintSchema, type Blueprint } from '@/server/ai/schemas'
import { applyPatch, specPatchSchema, type SpecPatch } from '@/server/spec/patch'
import { runChecks, type CheckReport } from '@/server/spec/checks'
import { buildTemplate, THEME_PRESETS, DEFAULT_THEME } from '@/server/spec/templates'
import { parseAppSpec } from '@/server/spec/validate'
import type { AppSpec } from '@/server/spec/schema'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/config'
import { heuristicBlueprint } from './blueprint-fallback'

/**
 * Cas d'usage « projet ».
 *
 * Aucune dépendance à HTTP : les routes se contentent de valider l'entrée et d'appeler
 * ces fonctions. Toute lecture ou écriture passe par une portée de locataire.
 *
 * Règle importante : les appels IA sont faits HORS transaction. Une transaction ouverte
 * ne doit jamais attendre un tiers.
 */

export const ideaInput = z.object({
  idea: z.string().trim().min(10, 'Décrivez votre idée en quelques mots de plus.').max(2000),
  locale: z.enum(SUPPORTED_LOCALES).default('fr'),
})

export type AnalysedIdea = {
  blueprint: Blueprint
  source: 'assistant' | 'modele-de-depart'
  creditsSpent: number
}

/** Étape 2 du parcours : proposer un plan avant de construire quoi que ce soit. */
export async function analyseIdea(
  userId: string,
  input: z.infer<typeof ideaInput>,
): Promise<AnalysedIdea> {
  await assertCanCreateProject(userId)

  if (!isAiAvailable()) {
    return { blueprint: heuristicBlueprint(input.idea), source: 'modele-de-depart', creditsSpent: 0 }
  }
  const result = await generateBlueprint(userId, input.idea, input.locale)
  return { blueprint: result.value, source: 'assistant', creditsSpent: result.creditsSpent }
}

export const createProjectInput = z.object({
  idea: z.string().trim().min(10).max(2000),
  locale: z.enum(SUPPORTED_LOCALES).default('fr'),
  blueprint: blueprintSchema,
})

export type CreatedProject = {
  projectId: string
  slug: string
  source: 'assistant' | 'modele-de-depart'
  creditsSpent: number
}

/** Étape 4 du parcours : construire réellement l'application et figer la version 1. */
export async function createProject(
  userId: string,
  input: z.infer<typeof createProjectInput>,
): Promise<CreatedProject> {
  await assertCanCreateProject(userId)

  const blueprint = input.blueprint
  if (!blueprint.feasible) {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      "Cette idée demande des fonctions que la plateforme ne sait pas encore construire.",
      { details: { limitations: blueprint.limitations } },
    )
  }

  const theme = THEME_PRESETS[blueprint.themePreset] ?? DEFAULT_THEME
  const fallbackSpec = buildTemplate(blueprint.templateKind, {
    name: blueprint.appName,
    tagline: blueprint.tagline,
    description: blueprint.description,
    locale: input.locale,
    theme,
  })

  const projectId = crypto.randomUUID()
  let spec = fallbackSpec
  let source: CreatedProject['source'] = 'modele-de-depart'
  let creditsSpent = 0

  if (isAiAvailable()) {
    try {
      const generated = await generateSpec(userId, projectId, blueprint, input.locale)
      spec = generated.value
      source = 'assistant'
      creditsSpent = generated.creditsSpent
    } catch (error) {
      // L'utilisateur obtient tout de même une application fonctionnelle, et on le lui dit.
      logger.warn("génération assistée en échec, repli sur le modèle de départ", {
        userId,
        reason: error instanceof Error ? error.message : 'inconnu',
      })
    }
  }

  const slug = await uniqueSlug(spec.name)

  await withUserScope(userId, async (tx) => {
    await tx.project.create({
      data: {
        id: projectId,
        ownerId: userId,
        name: spec.name,
        slug,
        locale: input.locale,
        idea: input.idea,
        blueprint: blueprint as unknown as Prisma.InputJsonValue,
        draftSpec: spec as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
      },
    })
    await createVersion(tx, projectId, spec, 'Première version', 'AI')
  })

  logger.info('projet créé', { userId, projectId, source })
  return { projectId, slug, source, creditsSpent }
}

export type ProjectSummary = {
  id: string
  name: string
  slug: string
  status: ProjectStatus
  updatedAt: Date
  publishedAt: Date | null
  readyScore: number | null
  themeColor: string
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  return withUserScope(userId, async (tx) => {
    const projects = await tx.project.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      status: project.status,
      updatedAt: project.updatedAt,
      publishedAt: project.publishedAt,
      readyScore: project.lastCheckScore,
      themeColor: readThemeColor(project.draftSpec),
    }))
  })
}

export type ProjectDetail = {
  id: string
  name: string
  slug: string
  status: ProjectStatus
  locale: Locale
  idea: string
  spec: AppSpec
  blueprint: Blueprint | null
  publishedAt: Date | null
  publishedVersionId: string | null
  report: CheckReport
  /** Vrai si un test a déjà été lancé sur ce projet : la progression survit au rechargement. */
  hasBeenTested: boolean
}

export async function getProject(userId: string, projectId: string): Promise<ProjectDetail> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const spec = parseAppSpec(project.draftSpec)
    const blueprint = blueprintSchema.safeParse(project.blueprint)
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      status: project.status,
      locale: project.locale as Locale,
      idea: project.idea,
      spec,
      blueprint: blueprint.success ? blueprint.data : null,
      publishedAt: project.publishedAt,
      publishedVersionId: project.publishedVersionId,
      report: runChecks(spec),
      hasBeenTested: project.lastCheckScore !== null,
    }
  })
}

export type EditOutcome = {
  reply: string
  applied: boolean
  summary: string | null
  spec: AppSpec
  creditsSpent: number
  versionNumber: number | null
}

/** Étape 6 du parcours : modifier l'application en langage naturel. */
export async function editWithAssistant(
  userId: string,
  projectId: string,
  message: string,
): Promise<EditOutcome> {
  const trimmed = message.trim()
  if (trimmed.length < 3) throw validation('Dites en quelques mots ce que vous voulez changer.')
  if (trimmed.length > 2000) throw validation('Votre message est trop long.')

  const current = await withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    await tx.chatMessage.create({
      data: { projectId, userId, role: 'USER', content: trimmed },
    })
    return parseAppSpec(project.draftSpec)
  })

  if (!isAiAvailable()) {
    const reply =
      "L'assistant n'est pas configuré sur cette installation. Vous pouvez tout de même modifier votre application depuis l'onglet Design."
    await recordAssistantMessage(userId, projectId, reply, null)
    return { reply, applied: false, summary: null, spec: current, creditsSpent: 0, versionNumber: null }
  }

  const result = await requestEdit(userId, projectId, current, trimmed)
  const response = result.value

  if (!response.supported || response.operations.length === 0) {
    await recordAssistantMessage(userId, projectId, response.reply, null)
    return {
      reply: response.reply,
      applied: false,
      summary: null,
      spec: current,
      creditsSpent: result.creditsSpent,
      versionNumber: null,
    }
  }

  // Le contrat de sortie de l'assistant est volontairement plus permissif que le moteur
  // de patch (champs optionnels selon l'opération). C'est ici que la forme est resserrée.
  let patch: SpecPatch
  let updated: AppSpec
  try {
    patch = specPatchSchema.parse({
      summary: response.summary,
      operations: response.operations,
    })
    updated = applyPatch(current, patch)
  } catch (error) {
    const reply =
      "Je n'ai pas réussi à appliquer cette modification sans casser votre application. Rien n'a été changé. Reformulez votre demande et je réessaie."
    await recordAssistantMessage(userId, projectId, reply, null)
    logger.warn('patch rejeté', {
      projectId,
      reason: error instanceof Error ? error.message : 'inconnu',
    })
    return {
      reply,
      applied: false,
      summary: null,
      spec: current,
      creditsSpent: result.creditsSpent,
      versionNumber: null,
    }
  }

  const versionNumber = await withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    const version = await createVersion(tx, projectId, updated, patch.summary, 'AI')
    await tx.project.update({
      where: { id: projectId },
      data: {
        draftSpec: updated as unknown as Prisma.InputJsonValue,
        name: updated.name,
        status: 'TESTING',
      },
    })
    await tx.chatMessage.create({
      data: {
        projectId,
        role: 'ASSISTANT',
        content: response.reply,
        operation: 'edit',
        versionId: version.id,
      },
    })
    return version.number
  })

  return {
    reply: response.reply,
    applied: true,
    summary: patch.summary,
    spec: updated,
    creditsSpent: result.creditsSpent,
    versionNumber,
  }
}

/**
 * Modification directe, sans IA et sans crédit (exigence 7 : éditeur visuel).
 * Même moteur de patch, donc mêmes garanties de validation.
 */
export async function applyManualPatch(
  userId: string,
  projectId: string,
  patch: SpecPatch,
): Promise<{ spec: AppSpec; versionNumber: number }> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const updated = applyPatch(parseAppSpec(project.draftSpec), patch)
    const version = await createVersion(tx, projectId, updated, patch.summary, 'USER')
    await tx.project.update({
      where: { id: projectId },
      data: {
        draftSpec: updated as unknown as Prisma.InputJsonValue,
        name: updated.name,
      },
    })
    return { spec: updated, versionNumber: version.number }
  })
}

export type VersionSummary = {
  id: string
  number: number
  label: string
  source: string
  createdAt: Date
  isCurrent: boolean
  isPublished: boolean
}

export async function listVersions(userId: string, projectId: string): Promise<VersionSummary[]> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const versions = await tx.projectVersion.findMany({
      where: { projectId },
      orderBy: { number: 'desc' },
      take: 100,
    })
    const currentJson = JSON.stringify(project.draftSpec)
    return versions.map((version) => ({
      id: version.id,
      number: version.number,
      label: version.label,
      source: version.source,
      createdAt: version.createdAt,
      isCurrent: JSON.stringify(version.spec) === currentJson,
      isPublished: version.id === project.publishedVersionId,
    }))
  })
}

/**
 * Restauration (exigence 19). L'historique n'est jamais réécrit : restaurer crée une
 * nouvelle version dont le contenu est celui d'une version antérieure.
 */
export async function restoreVersion(
  userId: string,
  projectId: string,
  versionId: string,
): Promise<{ spec: AppSpec; versionNumber: number }> {
  return withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    const source = await tx.projectVersion.findFirst({ where: { id: versionId, projectId } })
    if (!source) throw notFound('Cette version est introuvable.')

    const spec = parseAppSpec(source.spec)
    const version = await createVersion(
      tx,
      projectId,
      spec,
      `Retour à la version ${source.number}`,
      'RESTORE',
    )
    await tx.project.update({
      where: { id: projectId },
      data: { draftSpec: spec as unknown as Prisma.InputJsonValue, name: spec.name },
    })
    return { spec, versionNumber: version.number }
  })
}

export async function runProjectChecks(
  userId: string,
  projectId: string,
): Promise<CheckReport> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const report = runChecks(parseAppSpec(project.draftSpec))
    await tx.projectCheck.create({
      data: { projectId, score: report.score, results: report.results as unknown as Prisma.InputJsonValue },
    })
    await tx.project.update({
      where: { id: projectId },
      data: {
        lastCheckScore: report.score,
        status: project.status === 'DRAFT' ? 'TESTING' : project.status,
      },
    })
    return report
  })
}

export type PublishResult = { url: string; versionNumber: number; report: CheckReport }

/** Étape 7 : publier. Publier sert la version figée, jamais le brouillon. */
export async function publishProject(
  userId: string,
  projectId: string,
  appUrl: string,
): Promise<PublishResult> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const spec = parseAppSpec(project.draftSpec)
    const report = runChecks(spec)

    if (report.counts.error > 0) {
      const blocking = report.results.find((result) => result.status === 'error')
      throw new AppError('VALIDATION', 'Votre application a encore un point bloquant.', {
        details: { blocking, report },
      })
    }

    const version = await createVersion(tx, projectId, spec, 'Publication', 'USER')
    await tx.project.update({
      where: { id: projectId },
      data: {
        status: 'PUBLISHED',
        publishedVersionId: version.id,
        publishedAt: new Date(),
        lastCheckScore: report.score,
      },
    })

    return {
      url: `${appUrl.replace(/\/$/, '')}/a/${project.slug}`,
      versionNumber: version.number,
      report,
    }
  })
}

export async function listChatMessages(userId: string, projectId: string) {
  return withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    return tx.chatMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, role: true, content: true, createdAt: true },
    })
  })
}

// ────────────────────────────────── Internes ─────────────────────────────────

async function createVersion(
  tx: TenantClient,
  projectId: string,
  spec: AppSpec,
  label: string,
  source: 'AI' | 'USER' | 'RESTORE',
) {
  const last = await tx.projectVersion.findFirst({
    where: { projectId },
    orderBy: { number: 'desc' },
    select: { number: true },
  })
  return tx.projectVersion.create({
    data: {
      projectId,
      number: (last?.number ?? 0) + 1,
      label: label.slice(0, 120),
      spec: spec as unknown as Prisma.InputJsonValue,
      source,
    },
  })
}

async function recordAssistantMessage(
  userId: string,
  projectId: string,
  content: string,
  versionId: string | null,
): Promise<void> {
  await withUserScope(userId, async (tx) => {
    await tx.chatMessage.create({
      data: { projectId, role: 'ASSISTANT', content, versionId },
    })
  })
}

async function assertCanCreateProject(userId: string): Promise<void> {
  const plan = await getEffectivePlan(userId)
  const count = await prisma.project.count({ where: { ownerId: userId, deletedAt: null } })
  if (count >= plan.maxProjects) {
    throw new AppError(
      'PLAN_LIMIT',
      `Votre offre permet ${plan.maxProjects} application(s). Choisissez une offre supérieure pour en créer d'autres.`,
      { details: { maxProjects: plan.maxProjects, current: count } },
    )
  }
}

export function slugify(value: string): string {
  const base = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base.length >= 3 ? base : 'application'
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomBytes(3).toString('hex')}`
    const existing = await prisma.project.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!existing) return candidate
  }
  throw conflict("Impossible de réserver une adresse pour cette application. Réessayez.")
}

function readThemeColor(draftSpec: unknown): string {
  const colors = (draftSpec as { theme?: { colors?: { primary?: unknown } } })?.theme?.colors
  return typeof colors?.primary === 'string' ? colors.primary : '#2563EB'
}
