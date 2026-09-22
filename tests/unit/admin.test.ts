import { describe, expect, it } from 'vitest'
import { planUpdateInput, setPlanInput, userSearchInput } from '@/server/admin/service'
import { PLANNED_PLAN_CAPABILITIES } from '@/server/billing/plans'

/**
 * Le back-office écrit en base sans passer par le parcours : sa validation est donc la
 * seule barrière. Ces tests fixent ce qu'elle accepte, et surtout ce qu'elle refuse.
 */
describe('validation du back-office', () => {
  const valid = {
    name: 'Builder',
    description: 'Plusieurs projets et adresse personnalisée.',
    priceCents: 5900,
    priceYearCents: 0,
    maxProjects: 5,
    maxConnections: 3,
    storageMegabytes: 250,
    monthlyCredits: 350,
    sitesMax: 1,
    pagesPerAudit: 50,
    auditsPerMonth: 4,
    radarRunsPerMonth: 4,
    liaAnswersPerMonth: 500,
    alertsPerMonth: 0,
    imagesPerMonth: 0,
    liaConversationsPerMonth: 100,
    allowBuild: true,
    isRecommended: true,
    isActive: true,
    sortOrder: 2,
  }

  it('accepte une offre cohérente', () => {
    expect(() => planUpdateInput.parse(valid)).not.toThrow()
  })

  it('refuse un prix négatif', () => {
    expect(() => planUpdateInput.parse({ ...valid, priceCents: -1 })).toThrow()
  })

  it('refuse un prix à virgule, les centimes étant des entiers', () => {
    expect(() => planUpdateInput.parse({ ...valid, priceCents: 19.5 })).toThrow()
  })

  it('refuse un nom vide', () => {
    expect(() => planUpdateInput.parse({ ...valid, name: '   ' })).toThrow()
  })

  it("n'expose pas les capacités non construites", () => {
    const parsed = planUpdateInput.parse({
      ...valid,
      ...Object.fromEntries(PLANNED_PLAN_CAPABILITIES.map((capability) => [capability, true])),
    })
    for (const capability of PLANNED_PLAN_CAPABILITIES) {
      expect(capability in parsed).toBe(false)
    }
  })

  it('accepte de ramener un compte à l’offre gratuite', () => {
    expect(setPlanInput.parse({ planId: null }).planId).toBeNull()
  })

  it('refuse une recherche démesurée', () => {
    expect(() => userSearchInput.parse({ query: 'a'.repeat(200), take: 50 })).toThrow()
    expect(() => userSearchInput.parse({ query: '', take: 5000 })).toThrow()
  })

  it('borne la liste par défaut', () => {
    expect(userSearchInput.parse({}).take).toBe(50)
  })
})

/**
 * Le prix annuel.
 *
 * Il ouvre une seconde façon de payer la même offre, et la seule chose qui compte ici est
 * que zéro veuille dire « pas d'offre annuelle » plutôt que « gratuite à l'année ». La
 * remise, elle, n'est jamais saisie : elle se déduit des deux prix, ce qui les empêche de
 * se contredire.
 */
describe('le prix annuel d’une offre', () => {
  const valid = {
    name: 'Pro',
    description: 'Pour ceux qui travaillent leur visibilité régulièrement.',
    priceCents: 4900,
    priceYearCents: 47_000,
    maxProjects: 0,
    maxConnections: 3,
    storageMegabytes: 0,
    monthlyCredits: 600,
    sitesMax: 3,
    pagesPerAudit: 250,
    auditsPerMonth: 12,
    radarRunsPerMonth: 0,
    liaAnswersPerMonth: 0,
    alertsPerMonth: 0,
    imagesPerMonth: 0,
    liaConversationsPerMonth: 0,
    allowBuild: false,
    isRecommended: false,
    isActive: true,
    sortOrder: 2,
  }

  it('accepte un prix annuel', () => {
    expect(planUpdateInput.parse(valid).priceYearCents).toBe(47_000)
  })

  it('accepte zéro, qui veut dire « pas d’offre annuelle »', () => {
    expect(planUpdateInput.parse({ ...valid, priceYearCents: 0 }).priceYearCents).toBe(0)
  })

  it('refuse un prix annuel négatif ou à virgule', () => {
    expect(() => planUpdateInput.parse({ ...valid, priceYearCents: -1 })).toThrow()
    expect(() => planUpdateInput.parse({ ...valid, priceYearCents: 470.5 })).toThrow()
  })
})
