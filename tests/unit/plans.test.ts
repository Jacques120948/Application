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

  /**
   * La grille tarifaire liste désormais les crédits, le nombre d'applications et l'espace
   * d'images. Si deux offres voisines annonçaient les mêmes chiffres, la plus chère
   * n'aurait plus de raison d'être lisible : payer davantage doit se voir ligne à ligne.
   */
  it('donne strictement plus à chaque palier payant', () => {
    const paid = DEFAULT_PLANS.filter((plan) => plan.priceCents > 0).sort(
      (a, b) => a.priceCents - b.priceCents,
    )
    const mesures = ['monthlyCredits', 'maxProjects', 'storageBytes'] as const
    const regressions = paid.flatMap((plan, index) => {
      if (index === 0) return []
      const precedent = paid[index - 1]!
      return mesures
        .filter((mesure) => plan[mesure] <= precedent[mesure])
        .map((mesure) => `${plan.id} n'augmente pas ${mesure} par rapport à ${precedent.id}`)
    })
    expect(regressions).toEqual([])
  })

  /**
   * L'espace d'images est borné par offre parce que c'est la seule dépense qui grandirait
   * avec l'usage. Une offre sans borne rouvrirait la porte qu'il a fallu fermer.
   */
  it('borne l’espace d’images de toute offre qui construit', () => {
    const sansBorne = DEFAULT_PLANS.filter(
      (plan) => plan.allowBuild && plan.storageBytes <= 0,
    ).map((plan) => plan.id)
    expect(sansBorne).toEqual([])
  })

  it('ne recommande qu’une seule offre', () => {
    expect(DEFAULT_PLANS.filter((plan) => plan.isRecommended)).toHaveLength(1)
  })
})
