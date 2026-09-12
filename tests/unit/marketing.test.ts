import { describe, expect, it } from 'vitest'
import { appSpecSchema } from '@/server/spec/schema'
import { DEMO_APPS } from '@/server/demos/catalog'
import { toBrandContext, toneFromSpec } from '@/server/marketing/context'
import { launchKitSchema } from '@/lib/marketing'
import {
  DEFAULT_PLAN_FEATURES,
  FEATURES,
  liveFeatures,
  requireFeature,
  resolveEntitlements,
} from '@/server/billing/features'

/**
 * Intégration du moteur social.
 *
 * Ce qui est vérifié : qu'une offre n'ouvre jamais une fonction inexistante, qu'un droit
 * refusé le soit avec une phrase utilisable, et qu'un contexte de projet arrive chez le
 * moteur sans qu'on ait inventé ce que le créateur n'a pas dit.
 */

const PLANS = [
  { id: 'free', name: 'Découverte', features: [], sortOrder: 0 },
  {
    id: 'launch',
    name: 'Launch',
    features: [...(DEFAULT_PLAN_FEATURES.launch ?? [])],
    sortOrder: 1,
  },
  {
    id: 'builder',
    name: 'Builder',
    features: [...(DEFAULT_PLAN_FEATURES.builder ?? [])],
    sortOrder: 2,
  },
]

describe('droits par abonnement', () => {
  it('ouvre le kit de lancement dès la première offre payante', () => {
    const entitlements = resolveEntitlements(PLANS[1]!, PLANS)
    expect(entitlements.granted).toContain('social_launch_basic')
  })

  it('n’accorde rien à l’offre de découverte', () => {
    expect(resolveEntitlements(PLANS[0]!, PLANS).granted).toEqual([])
  })

  it('n’accorde jamais une fonction seulement prévue, même si l’offre la contient', () => {
    // Builder contient social_agent en base ; il n'est pas construit, il reste fermé.
    const entitlements = resolveEntitlements(PLANS[2]!, PLANS)
    expect(PLANS[2]!.features).toContain('social_agent')
    expect(entitlements.granted).not.toContain('social_agent')
  })

  it('ne présente comme verrouillée qu’une fonction qui existe vraiment', () => {
    const entitlements = resolveEntitlements(PLANS[0]!, PLANS)
    const live = liveFeatures().map((feature) => feature.id)
    for (const entry of entitlements.locked) {
      expect(live, entry.feature.id).toContain(entry.feature.id)
    }
  })

  it('nomme l’offre qui débloque une fonction verrouillée', () => {
    const entitlements = resolveEntitlements(PLANS[0]!, PLANS)
    const locked = entitlements.locked.find((entry) => entry.feature.id === 'social_launch_basic')
    expect(locked?.availableWith).toBe('Launch')
    expect(() => requireFeature(entitlements, 'social_launch_basic')).toThrowError(/Launch/)
  })

  it('distingue « pas dans votre offre » de « n’existe pas encore »', () => {
    const entitlements = resolveEntitlements(PLANS[1]!, PLANS)
    let thrown: unknown
    try {
      requireFeature(entitlements, 'seo_agent')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'UNSUPPORTED_REQUEST' })
  })

  it('ne répartit que des fonctions du catalogue', () => {
    const known = FEATURES.map((feature) => feature.id)
    for (const [plan, features] of Object.entries(DEFAULT_PLAN_FEATURES)) {
      for (const id of features) expect(known, `${plan} → ${id}`).toContain(id)
    }
  })
})

describe('contexte transmis au moteur', () => {
  const spec = appSpecSchema.parse(DEMO_APPS[0]!.spec)

  it('reprend ce que le créateur a déjà décrit, sans le redemander', () => {
    const brand = toBrandContext({
      project: { name: 'Projet', idea: 'une idée', locale: 'fr' },
      spec,
      idea: {
        title: 'DevisFlow',
        problem: 'Les artisans perdent leurs soirées à faire des devis',
        audience: 'Artisans indépendants',
        valueProposition: 'Un devis en deux minutes',
        features: ['Modèles', 'Envoi par e-mail'],
        differentiators: ['Pensé pour le chantier'],
        recommendedPriceCents: 2900,
        priceInterval: 'month',
        currency: 'CHF',
      },
      publicUrl: 'https://evoliia.com/a/devisflow',
    })

    expect(brand.name).toBe(spec.name)
    expect(brand.problem).toContain('artisans')
    expect(brand.features).toEqual(['Modèles', 'Envoi par e-mail'])
    expect(brand.priceLabel).toContain('CHF')
    expect(brand.website).toBe('https://evoliia.com/a/devisflow')
  })

  it('n’invente rien quand le projet ne vient pas du parcours guidé', () => {
    const brand = toBrandContext({
      project: { name: 'Mon appli', idea: 'un carnet de recettes', locale: 'fr' },
      spec: null,
      idea: null,
      publicUrl: null,
    })
    expect(brand.problem).toBe('')
    expect(brand.audience).toBe('')
    expect(brand.valueProposition).toBe('')
    expect(brand.priceLabel).toBeNull()
    expect(brand.website).toBeNull()
    expect(brand.description).toBe('un carnet de recettes')
  })

  it('ne facture pas une conversion de monnaie qui n’a pas eu lieu', () => {
    const brand = toBrandContext({
      project: { name: 'P', idea: '', locale: 'fr' },
      spec: null,
      idea: {
        title: 'T',
        problem: '',
        audience: '',
        valueProposition: '',
        features: [],
        differentiators: [],
        recommendedPriceCents: 1900,
        priceInterval: 'month',
        currency: 'CHF',
      },
      publicUrl: null,
    })
    expect(brand.priceLabel).toContain('CHF')
    expect(brand.priceLabel).not.toContain('€')
  })

  it('déduit le ton du thème choisi, sans en inventer davantage', () => {
    expect(toneFromSpec(null)).toEqual(['simple', 'direct'])
    expect(toneFromSpec(spec).length).toBeGreaterThanOrEqual(2)
  })

  it('retombe sur le français pour une langue inconnue', () => {
    const brand = toBrandContext({
      project: { name: 'P', idea: '', locale: 'xx' },
      spec: null,
      idea: null,
      publicUrl: null,
    })
    expect(brand.locale).toBe('fr')
  })
})

describe('réponse du moteur', () => {
  it('refuse un angle hors de la taxonomie partagée', () => {
    const result = launchKitSchema.safeParse({
      benefits: ['gain de temps'],
      valueProposition: 'un devis en deux minutes',
      angles: [{ key: 'INVENTE', title: 't', promise: 'p', example: 'e' }],
      ideas: [],
      week: [],
      ctas: ['essayez'],
    })
    expect(result.success).toBe(false)
  })

  it('accepte un kit complet et conforme', () => {
    const result = launchKitSchema.safeParse({
      benefits: ['gain de temps', 'moins d’oublis'],
      valueProposition: 'un devis en deux minutes',
      angles: [
        { key: 'PROBLEM_SOLUTION', title: 'Gain de temps', promise: 'p', example: 'e' },
      ],
      ideas: [
        {
          title: 'Le devis du soir',
          angleKey: 'PROBLEM_SOLUTION',
          format: 'POST',
          hook: 'Encore un devis oublié ?',
          description: 'Montrer le téléphone sur le chantier.',
          visual: 'Une photo du chantier',
        },
      ],
      week: [
        {
          day: 0,
          time: '18:30',
          angleKey: 'PROBLEM_SOLUTION',
          objective: 'AWARENESS',
          format: 'POST',
          caption: 'Votre devis envoyé avant de quitter le chantier.',
          hashtags: ['artisan', 'devis'],
          cta: 'Essayez gratuitement',
        },
      ],
      ctas: ['Essayez gratuitement'],
    })
    expect(result.success).toBe(true)
  })
})
