import { describe, expect, it } from 'vitest'
import type { Plan } from '@prisma/client'
import { comparePlans, planDetails, storageLabel } from '@/server/billing/plan-details'
import { FEATURES } from '@/server/billing/features'

/**
 * Le détail d'une offre est lu dans ses réglages, jamais dans son nom : une offre
 * renommée ou déplacée depuis le back-office reste décrite juste. Et une fonction
 * seulement prévue n'apparaît nulle part — elle ne se vend pas.
 */
function plan(overrides: Partial<Plan>): Plan {
  return {
    id: 'p',
    name: 'Offre',
    description: '',
    priceCents: 0,
    currency: 'EUR',
    interval: 'month',
    maxProjects: 1,
    maxConnections: 0,
    features: [],
    storageBytes: 0,
    radarRunsPerMonth: 0,
    liaAnswersPerMonth: 0,
    liaConversationsPerMonth: 0,
    alertsPerMonth: 0,
  imagesPerMonth: 0,
    monthlyCredits: 30,
    sitesMax: 1,
    pagesPerAudit: 50,
    auditsPerMonth: 4,
    allowExport: false,
    allowCustomDomain: false,
    allowMobilePrep: false,
    allowBuild: true,
    isRecommended: false,
    isActive: true,
    sortOrder: 0,
    stripeProductId: null,
    stripePriceId: null,
    stripePriceFingerprint: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('détail des offres', () => {
  it('décrit une offre sans construction comme s’arrêtant avant', () => {
    const groups = planDetails(plan({ allowBuild: false, monthlyCredits: 30 }), 'fr')
    const flat = groups.flatMap((group) => group.items)
    expect(flat).toContain('30 crédits par mois')
    expect(flat.some((item) => item.startsWith('S’arrête avant la construction'))).toBe(true)
    expect(flat).not.toContain('Construction et mise en ligne')
    expect(groups.map((group) => group.title)).not.toContain('Équipe marketing')
  })

  it('liste les fonctions ouvertes par leur nom de catalogue, groupées par thème', () => {
    const groups = planDetails(
      plan({
        maxProjects: 3,
        maxConnections: 3,
        storageBytes: 250 * 1024 * 1024,
        allowExport: true,
        features: ['social_launch_basic', 'social_agent', 'radar', 'lia_support'],
        radarRunsPerMonth: 3,
        liaAnswersPerMonth: 200,
        liaConversationsPerMonth: 50,
      }),
      'fr',
    )
    const byTitle = Object.fromEntries(groups.map((group) => [group.title, group.items]))
    expect(byTitle['Créer et mettre en ligne']).toEqual([
      'Jusqu’à 3 application(s)',
      'Construction et mise en ligne',
      'Installable sur l’écran d’accueil des téléphones',
      '250 Mo d’images à vous',
      '3 connexion(s) à des services externes',
      'Export du site complet',
    ])
    expect(byTitle['Lancement et réseaux sociaux']).toEqual(['Kit de lancement'])
    expect(byTitle['Équipe marketing']).toEqual(['Tom — Social Media Manager'])
    expect(byTitle['Radar d’opportunités']).toEqual(['Radar d’opportunités : 3 recherche(s) par mois'])
    expect(byTitle['Lia, support client']).toEqual([
      'Lia, support client dans vos applications : 200 réponses par mois',
      '50 conversations par mois',
    ])
  })

  it('ignore une fonction seulement prévue même si l’offre la contient', () => {
    const planned = FEATURES.find((feature) => feature.status === 'prevu')
    if (planned === undefined) return
    const groups = planDetails(plan({ features: [planned.id] }), 'fr')
    expect(groups.flatMap((group) => group.items)).not.toContain(planned.label)
    const comparison = comparePlans([plan({ features: [planned.id] })], 'fr')
    expect(comparison.sections.flatMap((section) => section.rows.map((row) => row.label))).not.toContain(
      planned.label,
    )
  })

  it('compare toutes les offres ligne par ligne, dans l’ordre reçu', () => {
    const comparison = comparePlans(
      [plan({ name: 'A', allowBuild: false }), plan({ name: 'B', maxProjects: 3, features: ['social_agent'] })],
      'fr',
    )
    expect(comparison.planNames).toEqual(['A', 'B'])
    const rows = Object.fromEntries(
      comparison.sections.flatMap((section) => section.rows.map((row) => [row.label, row.values])),
    )
    expect(rows['Applications']).toEqual([false, '3'])
    expect(rows['Construction et mise en ligne']).toEqual([false, true])
    expect(rows['Tom — Social Media Manager']).toEqual([false, true])
  })

  it('arrondit l’espace d’images en toutes lettres', () => {
    expect(storageLabel(250 * 1024 * 1024)).toBe('250 Mo')
    expect(storageLabel(2 * 1024 * 1024 * 1024)).toBe('2 Go')
  })
})
