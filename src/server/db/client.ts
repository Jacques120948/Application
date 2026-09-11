import { PrismaClient } from '@prisma/client'

/**
 * Client Prisma unique.
 *
 * Ce module est le seul endroit où `PrismaClient` est instancié. Toute lecture ou
 * écriture sur une table portant du Row Level Security doit passer par
 * `src/server/db/scope.ts`, qui ouvre une transaction et y positionne le contexte de
 * locataire. Voir docs/04-isolation-multi-tenant.md.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
