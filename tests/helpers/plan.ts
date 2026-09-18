import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import { prisma } from '@/server/db/client'
import { FEATURE_IDS } from '@/server/billing/features'

/**
 * L'offre technique des tests.
 *
 * Elle existe à cause d'une leçon payée une fois : les tests du constructeur s'abonnaient
 * aux offres commerciales — « launch », « builder » —, si bien que le jour où le catalogue a
 * changé, quatorze fichiers de test se sont mis à échouer sans qu'une seule ligne de produit
 * soit fautive. Un test ne doit pas dépendre d'une décision de marketing.
 *
 * Celle-ci n'est donc jamais vendue : elle n'est pas dans le catalogue par défaut, elle est
 * inactive, et elle ouvre tout. Ce qu'un test veut vérifier, c'est un comportement quand la
 * porte est ouverte ; les portes elles-mêmes se vérifient ailleurs, là où c'est le sujet.
 *
 * **Une offre par fichier de test**, et c'est une seconde leçon payée. Elle était unique et
 * partagée ; neuf fichiers la modifient — quota d'alertes à zéro, images fermées, audits
 * bornés — et les fichiers tournent en parallèle. Pire : la fonction ci-dessous réécrit
 * tous les champs, si bien qu'un fichier qui réclamait simplement l'offre remettait à zéro
 * le réglage qu'un autre venait de poser. Un test sur trois cents échouait alors, au hasard,
 * sur une assertion parfaitement juste — et un échec intermittent finit toujours par être
 * classé « aléa », ce qui use la confiance dans les sept cent quatre-vingt-cinq autres.
 *
 * Chaque fichier obtient donc sa copie, nommée d'après son chemin. `TEST_PLAN_ID` reste
 * exporté pour ce qui n'est pas un test ; dans un test, c'est `testPlanId()` qu'il faut.
 */

export const TEST_PLAN_ID = 'test-complet'

/**
 * L'offre propre au fichier de test en cours.
 *
 * Le chemin du fichier vient de Vitest. Hors d'un test — un appel depuis un script, par
 * exemple — on retombe sur l'offre commune, qui reste valable tant que personne ne la
 * modifie.
 */
export function testPlanId(): string {
  const chemin = expect.getState().testPath
  if (typeof chemin !== 'string' || chemin === '') return TEST_PLAN_ID
  const empreinte = createHash('sha1').update(chemin).digest('hex').slice(0, 10)
  return `${TEST_PLAN_ID}-${empreinte}`
}

/** Réserve mensuelle de l'offre de test. Large : aucun test ne doit échouer faute de crédits. */
export const TEST_PLAN_CREDITS = 5_000

const MEGABYTE = 1024 * 1024

export async function ensureTestPlan(planId = testPlanId()): Promise<string> {
  const valeurs = {
    name: 'Offre de test',
    description: 'Ouvre tout. Jamais vendue, jamais affichée.',
    priceCents: 0,
    currency: 'CHF',
    interval: 'month',
    maxProjects: 5,
    maxConnections: 5,
    features: [...FEATURE_IDS],
    storageBytes: 50 * MEGABYTE,
    radarRunsPerMonth: 100,
    liaAnswersPerMonth: 1_000,
    liaConversationsPerMonth: 500,
    alertsPerMonth: 0,
    imagesPerMonth: 0,
    sitesMax: 10,
    pagesPerAudit: 1_000,
    auditsPerMonth: 100,
    monthlyCredits: TEST_PLAN_CREDITS,
    allowBuild: true,
    allowExport: true,
    allowCustomDomain: true,
    allowMobilePrep: true,
    isRecommended: false,
    // Inactive : elle ne doit jamais apparaître dans une grille tarifaire publique.
    isActive: false,
    sortOrder: 999,
  }
  await prisma.plan.upsert({
    where: { id: planId },
    update: valeurs,
    create: { id: planId, ...valeurs },
  })
  return planId
}

/** Abonne quelqu'un à l'offre de test. Le geste que font presque tous les tests d'atelier. */
export async function subscribeToTestPlan(userId: string): Promise<void> {
  const planId = await ensureTestPlan()
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId, status: 'ACTIVE' },
    update: { planId, status: 'ACTIVE' },
  })
}
