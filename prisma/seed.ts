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
        allowBuild: plan.allowBuild,
        allowExport: plan.allowExport,
        allowCustomDomain: plan.allowCustomDomain,
        allowMobilePrep: plan.allowMobilePrep,
        isRecommended: plan.isRecommended,
        isActive: true,
        sortOrder: plan.sortOrder,
      },
      create: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        maxProjects: plan.maxProjects,
        monthlyCredits: plan.monthlyCredits,
        allowBuild: plan.allowBuild,
        allowExport: plan.allowExport,
        allowCustomDomain: plan.allowCustomDomain,
        allowMobilePrep: plan.allowMobilePrep,
        isRecommended: plan.isRecommended,
        sortOrder: plan.sortOrder,
      },
    })
  }
  // Une offre retirée du modèle n'est jamais supprimée : des abonnements peuvent encore
  // la référencer. Elle est simplement rendue invisible.
  const retired = await prisma.plan.updateMany({
    where: { id: { notIn: DEFAULT_PLANS.map((plan) => plan.id) }, isActive: true },
    data: { isActive: false },
  })

  console.log(`Offres initialisées : ${DEFAULT_PLANS.map((plan) => plan.id).join(', ')}`)
  if (retired.count > 0) console.log(`Offres retirées du catalogue : ${retired.count}`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
