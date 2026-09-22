import { PrismaClient } from '@prisma/client'
import { DEFAULT_PLANS, PLANNED_PLAN_CAPABILITIES } from '../src/server/billing/plans'
import { DEFAULT_MODEL_PRICING } from '../src/server/billing/ai-pricing'
import {
  activerRadarEtLiaUneFois,
  ouvrirSearchConsoleUneFois,
} from '../src/server/billing/activation'

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
        priceYearCents: plan.priceYearCents,
        currency: plan.currency,
        sitesMax: plan.sitesMax,
        pagesPerAudit: plan.pagesPerAudit,
        auditsPerMonth: plan.auditsPerMonth,
        maxProjects: plan.maxProjects,
        maxConnections: plan.maxConnections,
        features: [...plan.features],
        storageBytes: plan.storageBytes,
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

  // Ouverture du Radar et de Lia : une fois par installation, jamais rejouée ensuite, pour
  // que l'exploitant reste maître de ses offres après ce premier geste.
  const ouverture = await activerRadarEtLiaUneFois(prisma)
  if (ouverture === null) console.log('Radar et Lia : ouverture déjà faite, offres laissées telles quelles.')
  else for (const ligne of ouverture) console.log(`Radar et Lia ouverts — ${ligne}`)

  // Même geste pour les chiffres de recherche, et pour la même raison : la colonne
  // `features` d'une offre en service appartient à l'exploitant, le démarrage ne la réécrit
  // pas. Sans cette ouverture, la fonction n'atteindrait que les offres créées après elle.
  const recherches = await ouvrirSearchConsoleUneFois(prisma)
  if (recherches === null) {
    console.log('Chiffres de recherche : ouverture déjà faite, offres laissées telles quelles.')
  } else for (const ligne of recherches) console.log(`Chiffres de recherche — ${ligne}`)

  await seedTarifsIa()
  /*
   * Les démonstrations ne sont plus semées.
   *
   * Six applications — DevisFlow, FitPilot, Cooksy, ImmoTrack, StudyFlow, Bookizy — étaient
   * republiées à chaque déploiement pour montrer sur la page d'accueil ce que le
   * constructeur savait faire. La page d'accueil ne présente plus d'applications, et le
   * constructeur n'est plus vendu : elles ne montraient donc plus rien à personne, tout en
   * se recréant chaque jour. Le semis reste écrit dans `prisma/seed-demos.ts`, pour le cas
   * où l'atelier reprendrait du service : c'est un appel à remettre, pas un fichier à
   * réécrire.
   */
  await promoteAdmin()
}

/**
 * Tarifs des modèles, écrits une fois pour que l'administration ait des lignes à modifier.
 *
 * `create` seulement, jamais `update` : un tarif corrigé depuis le back-office ne doit pas
 * être réécrit par le prochain déploiement. Le code ne fait qu'amorcer la table ; ensuite
 * elle appartient à l'exploitant.
 */
async function seedTarifsIa(): Promise<void> {
  let ajoutes = 0
  for (const [model, price] of Object.entries(DEFAULT_MODEL_PRICING)) {
    const existe = await prisma.aiModelPricing.findUnique({ where: { model } })
    if (existe !== null) continue
    await prisma.aiModelPricing.create({
      data: {
        model,
        label: price.label,
        inputCentsPerMTok: price.input,
        outputCentsPerMTok: price.output,
        cacheReadCentsPerMTok: price.cacheRead,
      },
    })
    ajoutes += 1
  }
  console.log(
    ajoutes > 0 ? `Tarifs IA initialisés : ${ajoutes}` : 'Tarifs IA : déjà en place, rien modifié.',
  )
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
