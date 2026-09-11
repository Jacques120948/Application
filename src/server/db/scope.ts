import type { Prisma } from '@prisma/client'
import { prisma } from './client'
import { notFound } from '@/lib/errors'

/**
 * Portée de locataire.
 *
 * PostgreSQL applique des politiques Row Level Security qui lisent deux variables de
 * session. Ce module est le seul à pouvoir les positionner, et il le fait avec
 * `set_config(..., is_local => true)` : le contexte meurt avec la transaction, ce qui est
 * indispensable avec un pool de connexions.
 *
 * Contrainte d'usage : ne jamais placer un appel réseau lent (IA, Stripe) à l'intérieur
 * d'une portée — une transaction ouverte ne doit pas attendre un tiers.
 */

export type TenantClient = Prisma.TransactionClient

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assertUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw notFound(`Identifiant ${label} invalide.`)
  return value
}

const TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 } as const

/** Exécute `fn` avec les droits du créateur `userId`. */
export async function withUserScope<T>(
  userId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  assertUuid(userId, 'utilisateur')
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`
    return fn(tx)
  }, TRANSACTION_OPTIONS)
}

/**
 * Exécute `fn` avec la portée du runtime public d'une application publiée.
 * Aucun créateur n'est impliqué : seules les lignes de ce projet sont visibles.
 */
export async function withRuntimeScope<T>(
  projectId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  assertUuid(projectId, 'projet')
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_project_id', ${projectId}, true)`
    return fn(tx)
  }, TRANSACTION_OPTIONS)
}

/** Portée combinée : le créateur consulte les données de sa propre application. */
export async function withOwnerRuntimeScope<T>(
  userId: string,
  projectId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  assertUuid(userId, 'utilisateur')
  assertUuid(projectId, 'projet')
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`
    await tx.$executeRaw`SELECT set_config('app.current_project_id', ${projectId}, true)`
    return fn(tx)
  }, TRANSACTION_OPTIONS)
}

/**
 * Charge un projet en vérifiant qu'il appartient bien à l'utilisateur.
 * Lève « introuvable » et non « interdit » : ne pas confirmer l'existence du projet d'autrui.
 */
export async function requireOwnedProject(tx: TenantClient, projectId: string, ownerId: string) {
  assertUuid(projectId, 'projet')
  const project = await tx.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
  })
  if (!project) throw notFound("Cette application est introuvable.")
  return project
}
