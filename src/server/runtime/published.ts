import { notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withRuntimeScope } from '@/server/db/scope'
import { parseAppSpec } from '@/server/spec/validate'
import type { AppSpec } from '@/server/spec/schema'

/**
 * Résolution d'une application publiée.
 *
 * Point clé : on sert la **version publiée**, jamais le brouillon en cours. Un créateur
 * qui expérimente dans l'éditeur ne casse pas son application en ligne.
 */

export type PublishedApp = {
  projectId: string
  slug: string
  spec: AppSpec
  versionId: string
  /** Propriétaire : c'est son compte Stripe qui encaisse, ses crédits que l'assistant consomme. */
  ownerId: string
}

export async function getPublishedApp(slug: string): Promise<PublishedApp> {
  const project = await prisma.project.findFirst({
    where: { slug, publishedAt: { not: null }, deletedAt: null },
    select: { id: true, slug: true, publishedVersionId: true, ownerId: true },
  })
  if (!project || project.publishedVersionId === null) {
    throw notFound("Cette application n'existe pas ou n'est plus en ligne.")
  }

  const version = await withRuntimeScope(project.id, (tx) =>
    tx.projectVersion.findFirst({
      where: { id: project.publishedVersionId as string, projectId: project.id },
      select: { id: true, spec: true },
    }),
  )
  if (!version) throw notFound("Cette application n'est plus disponible.")

  return {
    projectId: project.id,
    slug: project.slug,
    spec: parseAppSpec(version.spec),
    versionId: version.id,
    ownerId: project.ownerId,
  }
}

/** Enregistre une visite pour les statistiques du créateur (exigence 33). */
export async function recordVisit(projectId: string, path: string): Promise<void> {
  await withRuntimeScope(projectId, (tx) =>
    tx.appEvent.create({ data: { projectId, type: 'view', path: path.slice(0, 200) } }),
  ).catch(() => undefined)
}

/**
 * Nombre d'applications actuellement en ligne.
 *
 * Cette lecture vit ici, avec les autres lectures d'applications publiées, et pas dans le
 * back-office : les projets publiés sont publics par construction, tout le reste de la
 * table reste masqué par le Row Level Security.
 */
export async function countPublishedApps(): Promise<number> {
  return prisma.project.count({ where: { publishedAt: { not: null }, deletedAt: null } })
}

/** Type d'événement enregistré à chaque réponse de l'assistant d'une application. */
export const ASSISTANT_EVENT = 'assistant'

/**
 * Nombre de réponses données aujourd'hui par l'assistant d'une application.
 *
 * Sert de plafond journalier, indépendant du serveur qui traite la requête. Le compteur en
 * mémoire ne suffirait pas : une application servie par plusieurs instances aurait autant
 * de compteurs que d'instances.
 */
export async function countAssistantAnswersToday(projectId: string): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  return withRuntimeScope(projectId, (tx) =>
    tx.appEvent.count({
      where: { projectId, type: ASSISTANT_EVENT, createdAt: { gte: since } },
    }),
  )
}

/** Journalise une réponse, pour le plafond journalier et pour les statistiques du créateur. */
export async function recordAssistantAnswer(projectId: string): Promise<void> {
  await withRuntimeScope(projectId, (tx) =>
    tx.appEvent.create({ data: { projectId, type: ASSISTANT_EVENT } }),
  ).catch(() => undefined)
}
