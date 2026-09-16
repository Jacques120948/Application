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
 */

export const TEST_PLAN_ID = 'test-complet'

/** Réserve mensuelle de l'offre de test. Large : aucun test ne doit échouer faute de crédits. */
export const TEST_PLAN_CREDITS = 5_000

const MEGABYTE = 1024 * 1024

export async function ensureTestPlan(): Promise<string> {
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
    where: { id: TEST_PLAN_ID },
    update: valeurs,
    create: { id: TEST_PLAN_ID, ...valeurs },
  })
  return TEST_PLAN_ID
}

/** Abonne quelqu'un à l'offre de test. Le geste que font presque tous les tests d'atelier. */
export async function subscribeToTestPlan(userId: string): Promise<void> {
  await ensureTestPlan()
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId: TEST_PLAN_ID, status: 'ACTIVE' },
    update: { planId: TEST_PLAN_ID, status: 'ACTIVE' },
  })
}
