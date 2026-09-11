import { PrismaClient } from '@prisma/client'
import { DEFAULT_PLANS } from '../src/server/billing/plans'

/**
 * Initialisation d'une installation.
 *
 * Insère les offres par défaut. Les limites et tarifs restent modifiables ensuite depuis
 * l'administration : ce fichier ne fait que poser des valeurs de départ.
 *
 * Le compte de démonstration n'est créé qu'en dehors de la production.
 */

const prisma = new PrismaClient()

async function main(): Promise<void> {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        maxProjects: plan.maxProjects,
        monthlyCredits: plan.monthlyCredits,
        allowExport: plan.allowExport,
        allowCustomDomain: plan.allowCustomDomain,
        allowMobilePrep: plan.allowMobilePrep,
        sortOrder: plan.sortOrder,
      },
      create: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        maxProjects: plan.maxProjects,
        monthlyCredits: plan.monthlyCredits,
        allowExport: plan.allowExport,
        allowCustomDomain: plan.allowCustomDomain,
        allowMobilePrep: plan.allowMobilePrep,
        sortOrder: plan.sortOrder,
      },
    })
  }
  console.log(`Offres initialisées : ${DEFAULT_PLANS.map((plan) => plan.id).join(', ')}`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
