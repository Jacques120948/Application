import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLANS,
  FREE_PLAN_ID,
  PLANNED_PLAN_CAPABILITIES,
} from '@/server/billing/plans'

/**
 * Une offre ne doit jamais promettre ce que le produit ne sait pas encore faire.
 *
 * Cette règle est née d'un vrai défaut : la grille tarifaire annonçait « Export du code »
 * et « Préparation pour mobile », deux cases cochées en base sans une ligne de code
 * derrière. Tant que ces fonctions n'existent pas, aucune offre ne peut les afficher.
 */
describe('offres', () => {
  it("n'annonce aucune capacité non construite", () => {
    const offenders = DEFAULT_PLANS.flatMap((plan) =>
      PLANNED_PLAN_CAPABILITIES.filter((capability) => plan[capability]).map(
        (capability) => `${plan.id} annonce ${capability}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  it('garde une offre gratuite qui ne construit pas', () => {
    const free = DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)
    expect(free?.priceCents).toBe(0)
    expect(free?.allowBuild).toBe(false)
  })

  it('propose des offres payantes ordonnées et distinctes', () => {
    const paid = DEFAULT_PLANS.filter((plan) => plan.priceCents > 0)
    expect(paid.length).toBeGreaterThanOrEqual(2)
    const prices = paid.map((plan) => plan.priceCents)
    expect([...prices].sort((a, b) => a - b)).toEqual(prices)
    expect(new Set(DEFAULT_PLANS.map((plan) => plan.id)).size).toBe(DEFAULT_PLANS.length)
  })

  it('ne recommande qu’une seule offre', () => {
    expect(DEFAULT_PLANS.filter((plan) => plan.isRecommended)).toHaveLength(1)
  })
})
