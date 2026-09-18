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
  it('met la visibilité en tête et ne parle pas du constructeur quand il est fermé', () => {
    const groups = planDetails(
      plan({ allowBuild: false, monthlyCredits: 30, sitesMax: 3, pagesPerAudit: 250, auditsPerMonth: 12 }),
      'fr',
    )
    // Ce qui se vend d'abord s'affiche d'abord.
    expect(groups[0]?.title).toBe('Visibilité')
    expect(groups[0]?.items).toEqual([
      '3 sites suivis',
      'jusqu’à 250 pages analysées par audit',
      '12 audits par mois',
    ])

    const flat = groups.flatMap((group) => group.items)
    expect(flat).toContain('30 crédits par mois')
    /*
     * Rien du constructeur, pas même pour dire qu'il est absent : annoncer « s'arrête avant
     * la construction » à quelqu'un venu faire analyser son site, c'est lui parler d'un
     * produit qu'il n'a pas demandé.
     */
    expect(groups.map((group) => group.title)).not.toContain('Créer et mettre en ligne')
    expect(flat).not.toContain('Construction et mise en ligne')
    expect(groups.map((group) => group.title)).not.toContain('Votre équipe')
  })

  it('accorde le nombre de sites et d’audits', () => {
    /*
     * « 1 audits par mois » sur l'offre d'essai est la première chose qu'on lit du produit.
     * Une faute d'accord à cet endroit coûte plus cher qu'elle n'en a l'air.
     */
    const seul = planDetails(plan({ sitesMax: 1, auditsPerMonth: 1 }), 'fr')[0]?.items
    expect(seul?.[0]).toBe('1 site suivi')
    expect(seul?.[2]).toBe('1 audit par mois')

    const plusieurs = planDetails(plan({ sitesMax: 3, auditsPerMonth: 12 }), 'fr')[0]?.items
    expect(plusieurs?.[0]).toBe('3 sites suivis')
    expect(plusieurs?.[2]).toBe('12 audits par mois')
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
    expect(byTitle['Visibilité']).toEqual([
      '1 site suivi',
      'jusqu’à 50 pages analysées par audit',
      '4 audits par mois',
      'Export des rapports',
    ])
    expect(byTitle['Créer et mettre en ligne']).toEqual([
      'Jusqu’à 3 application(s)',
      'Construction et mise en ligne',
      'Installable sur l’écran d’accueil des téléphones',
      '250 Mo d’images à vous',
    ])
    expect(byTitle['Connexions']).toEqual(['3 connexion(s) à des services externes'])
    expect(byTitle['Lancement et réseaux sociaux']).toEqual(['Kit de lancement'])
    expect(byTitle['Votre équipe']).toEqual(['Tom — Social Media Manager'])
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
    expect(rows['Sites suivis']).toEqual(['1', '1'])
    expect(rows['Applications']).toEqual([false, '3'])
    expect(rows['Construction et mise en ligne']).toEqual([false, true])
    expect(rows['Tom — Social Media Manager']).toEqual([false, true])

    // Aucune offre ne construit : la section entière disparaît plutôt que de barrer
    // quatre lignes, ce qui n'informe de rien et fait douter du reste.
    const sansAtelier = comparePlans([plan({ name: 'A', allowBuild: false })], 'fr')
    expect(sansAtelier.sections.map((section) => section.title)).not.toContain(
      'Créer et mettre en ligne',
    )
    expect(sansAtelier.sections[0]?.title).toBe('Visibilité')
  })

  it('retire une ligne qu’aucune offre n’accorde, et la section qui n’en garde aucune', () => {
    /*
     * Le cas s'est produit en production. Le produit a changé de métier : les fonctions de
     * l'ancien sont restées au catalogue, plus aucune offre ne les ouvrait, et la grille
     * affichait onze rangées entièrement barrées — sous des titres qui parlaient encore de
     * réseaux sociaux et d'équipe marketing. Quatre tirets n'apprennent rien à personne et
     * donnent au produit l'air plus pauvre qu'il n'est.
     */
    const aucune = comparePlans([plan({ name: 'A' }), plan({ name: 'B' })], 'fr')
    const lignes = aucune.sections.flatMap((section) => section.rows)

    expect(lignes.map((ligne) => ligne.label)).not.toContain('Tom — Social Media Manager')
    expect(aucune.sections.map((section) => section.title)).not.toContain('Votre équipe')
    // Aucune ligne subsistante n'est entièrement barrée.
    expect(lignes.filter((ligne) => ligne.values.every((valeur) => valeur === false))).toEqual([])

    // Mais une ligne qu'une seule offre accorde reste : c'est précisément ce qui distingue.
    const une = comparePlans(
      [plan({ name: 'A' }), plan({ name: 'B', features: ['social_agent'] })],
      'fr',
    )
    const gardees = une.sections.flatMap((section) => section.rows.map((ligne) => ligne.label))
    expect(gardees).toContain('Tom — Social Media Manager')
  })

  it('n’annonce la boutique que là où elle peut réellement se brancher', () => {
    /*
     * Deux conditions, pas une : la fonction accordée, et une place de connexion. L'offre
     * d'essai a les quatre spécialistes mais aucune connexion extérieure ; lui promettre sa
     * boutique reviendrait à afficher une coche devant une porte qui ne s'ouvre pas.
     */
    const grille = comparePlans(
      [
        plan({ name: 'Essai', maxConnections: 0, features: ['shopify_read'] }),
        plan({ name: 'Starter', maxConnections: 1, features: ['shopify_read'] }),
        plan({ name: 'Sans', maxConnections: 3, features: [] }),
      ],
      'fr',
    )
    const ligne = grille.sections
      .flatMap((section) => section.rows)
      .find((row) => row.label === 'Votre boutique Shopify')

    expect(ligne?.values).toEqual([false, true, false])
  })

  it('arrondit l’espace d’images en toutes lettres', () => {
    expect(storageLabel(250 * 1024 * 1024)).toBe('250 Mo')
    expect(storageLabel(2 * 1024 * 1024 * 1024)).toBe('2 Go')
  })
})
