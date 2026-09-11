import { notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { getCurrentUser } from '@/server/auth/session'
import { withRuntimeScope, withUserScope } from '@/server/db/scope'
import { parseAppSpec } from '@/server/spec/validate'
import type { AppSpec } from '@/server/spec/schema'

/**
 * Détermine quelle version de l'application sert de référence pour une requête.
 *
 * - Le créateur propriétaire travaille sur son brouillon (aperçu).
 * - Tout le monde d'autre voit la version publiée, et uniquement elle.
 *
 * Cette distinction est faite côté serveur à chaque requête : le navigateur ne peut pas
 * demander à voir le brouillon d'un projet qui ne lui appartient pas.
 */

export type RuntimeSpecContext = {
  projectId: string
  slug: string
  spec: AppSpec
  isOwnerPreview: boolean
}

export async function resolveRuntimeSpec(projectId: string): Promise<RuntimeSpecContext> {
  const user = await getCurrentUser()

  if (user !== null) {
    const owned = await withUserScope(user.id, (tx) =>
      tx.project.findFirst({
        where: { id: projectId, ownerId: user.id, deletedAt: null },
        select: { id: true, slug: true, draftSpec: true },
      }),
    )
    if (owned) {
      return {
        projectId: owned.id,
        slug: owned.slug,
        spec: parseAppSpec(owned.draftSpec),
        isOwnerPreview: true,
      }
    }
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, publishedAt: { not: null }, deletedAt: null },
    select: { id: true, slug: true, publishedVersionId: true },
  })
  if (!project || project.publishedVersionId === null) {
    throw notFound("Cette application n'existe pas ou n'est plus en ligne.")
  }

  const version = await withRuntimeScope(project.id, (tx) =>
    tx.projectVersion.findFirst({
      where: { id: project.publishedVersionId as string, projectId: project.id },
      select: { spec: true },
    }),
  )
  if (!version) throw notFound("Cette application n'est plus disponible.")

  return {
    projectId: project.id,
    slug: project.slug,
    spec: parseAppSpec(version.spec),
    isOwnerPreview: false,
  }
}
