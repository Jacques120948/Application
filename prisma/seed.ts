import { PrismaClient } from '@prisma/client'
import { DEFAULT_PLANS, PLANNED_PLAN_CAPABILITIES } from '../src/server/billing/plans'
import { seedDemoApps } from './seed-demos'

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
      /*
       * Une offre déjà en base appartient à l'exploitant, pas au code.
       *
       * Les prix, limites et crédits se règlent depuis le back-office (exigence 34) : les
       * réécrire ici annulerait ces réglages à chaque mise en ligne. Seules sont forcées
       * les capacités que le produit ne sait pas encore honorer, pour qu'aucune offre ne
       * puisse promettre une fonction inexistante.
       */
      update: Object.fromEntries(
        PLANNED_PLAN_CAPABILITIES.map((capability) => [capability, false]),
      ),
      create: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        maxProjects: plan.maxProjects,
        maxConnections: plan.maxConnections,
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

  // Une offre d'une version précédente peut encore porter une capacité non construite, et
  // un abonnement peut encore la référencer. On les éteint partout, pas seulement sur les
  // offres du catalogue courant.
  await prisma.plan.updateMany({
    where: { OR: PLANNED_PLAN_CAPABILITIES.map((capability) => ({ [capability]: true })) },
    data: Object.fromEntries(PLANNED_PLAN_CAPABILITIES.map((capability) => [capability, false])),
  })

  console.log(`Offres initialisées : ${DEFAULT_PLANS.map((plan) => plan.id).join(', ')}`)
  if (retired.count > 0) console.log(`Offres retirées du catalogue : ${retired.count}`)

  await seedDemoApps(prisma)
  await promoteAdmin()
}

/**
 * Promotion du compte administrateur.
 *
 * L'adresse vient de la variable ADMIN_EMAIL. Sans elle, rien n'est promu : une
 * installation reste sans back-office tant que son propriétaire ne s'est pas désigné.
 * Le compte doit exister, sinon on le signale sans faire échouer la mise en ligne.
 */
async function promoteAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) {
    console.log('ADMIN_EMAIL absente : aucun administrateur promu.')
    return
  }
  const updated = await prisma.user.updateMany({
    where: { email, role: 'USER' },
    data: { role: 'ADMIN' },
  })
  const exists = await prisma.user.count({ where: { email } })
  if (exists === 0) {
    console.log(`ADMIN_EMAIL « ${email} » : aucun compte à cette adresse, rien promu.`)
    return
  }
  console.log(
    updated.count > 0
      ? `Administrateur promu : ${email}`
      : `Administrateur déjà en place : ${email}`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
