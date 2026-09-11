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
}

export async function getPublishedApp(slug: string): Promise<PublishedApp> {
  const project = await prisma.project.findFirst({
    where: { slug, publishedAt: { not: null }, deletedAt: null },
    select: { id: true, slug: true, publishedVersionId: true },
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
  }
}

/** Enregistre une visite pour les statistiques du créateur (exigence 33). */
export async function recordVisit(projectId: string, path: string): Promise<void> {
  await withRuntimeScope(projectId, (tx) =>
    tx.appEvent.create({ data: { projectId, type: 'view', path: path.slice(0, 200) } }),
  ).catch(() => undefined)
}
