import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLANS,
  FREE_PLAN_ID,
  PLANNED_PLAN_CAPABILITIES,
} from '@/server/billing/plans'
import { LEGACY_FEATURE_IDS, isLegacyFeature } from '@/server/billing/features'

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
    /*
     * Les mesures qui font la valeur du produit de visibilité. Elles ont remplacé les
     * projets et l'espace d'images, qui mesuraient le constructeur d'applications : un
     * palier doit donner davantage de ce qu'on vient y chercher, et plus personne ne vient
     * y chercher des projets.
     */
    const mesures = ['monthlyCredits', 'sitesMax', 'pagesPerAudit', 'auditsPerMonth'] as const
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

/**
 * Ce qui reste du premier Evoliia ne se vend plus.
 *
 * Le produit a changé de métier : il analysait puis construisait des applications, il
 * travaille maintenant la visibilité. Le moteur de l'ancien répond encore et des offres
 * anciennes le portent encore en base, mais plus aucun écran n'y conduit. Une offre neuve
 * qui l'accorderait vendrait une porte sans couloir — et c'est le genre d'erreur qui se
 * fait en recopiant une offre voisine sans relire ce qu'elle contient.
 */
describe('héritage du constructeur d’applications', () => {
  it("n'accorde aucune fonction de l'ancien produit dans les offres de départ", () => {
    const offenders = DEFAULT_PLANS.flatMap((plan) =>
      plan.features.filter(isLegacyFeature).map((id) => `${plan.id} accorde ${id}`),
    )
    expect(offenders).toEqual([])
  })

  it("n'ouvre le constructeur dans aucune offre de départ", () => {
    expect(DEFAULT_PLANS.filter((plan) => plan.allowBuild).map((plan) => plan.id)).toEqual([])
    expect(DEFAULT_PLANS.filter((plan) => plan.maxProjects > 0).map((plan) => plan.id)).toEqual([])
  })

  /*
   * La liste sert de carte : elle nomme ce qu'il faudra retirer le jour où le moteur du
   * constructeur partira. Une liste vide voudrait dire que la carte a été perdue, pas que
   * le ménage est fait.
   */
  it('garde trace de ce qui appartient à l’ancien produit', () => {
    expect(LEGACY_FEATURE_IDS.length).toBeGreaterThan(0)
  })
})

/**
 * Le prix annuel, et ce qui doit rester vrai quels que soient les montants réglés.
 *
 * Une grille tarifaire se change souvent, et chaque changement est l'occasion d'une
 * incohérence qui ne se voit pas en la relisant : une offre supérieure dont le crédit
 * revient plus cher, un prix annuel plus élevé que douze mensualités. Ni l'un ni l'autre
 * ne fait planter quoi que ce soit — ils font juste perdre de l'argent ou de la crédibilité.
 */
describe('la cohérence de la grille tarifaire', () => {
  const payantes = DEFAULT_PLANS.filter((plan) => plan.priceCents > 0)

  it('ne demande jamais plus à l’année que douze mensualités', () => {
    const offenders = payantes
      .filter((plan) => plan.priceYearCents > 0 && plan.priceYearCents > plan.priceCents * 12)
      .map((plan) => plan.id)
    expect(offenders).toEqual([])
  })

  it('offre bien deux mois sur l’année', () => {
    const offenders = payantes
      .filter((plan) => plan.priceYearCents !== plan.priceCents * 10)
      .map((plan) => `${plan.id} : ${plan.priceYearCents} au lieu de ${plan.priceCents * 10}`)
    expect(offenders).toEqual([])
  })

  it('ne facture jamais l’offre gratuite à l’année', () => {
    const gratuites = DEFAULT_PLANS.filter((plan) => plan.priceCents === 0)
    expect(gratuites.filter((plan) => plan.priceYearCents > 0)).toEqual([])
  })

  /*
   * La seule contrainte structurelle de l'échelle. Une offre supérieure dont le crédit
   * coûte plus cher donne à quelqu'un une raison de rester en dessous — et il la trouve,
   * parce que c'est la première division que fait celui qui hésite.
   */
  it('fait baisser le prix du crédit à mesure que l’offre monte', () => {
    const regressions = payantes.flatMap((plan, index) => {
      if (index === 0) return []
      const precedent = payantes[index - 1]!
      const ici = plan.priceCents / plan.monthlyCredits
      const avant = precedent.priceCents / precedent.monthlyCredits
      return ici >= avant ? [`${plan.id} vend le crédit plus cher que ${precedent.id}`] : []
    })
    expect(regressions).toEqual([])
  })
})
