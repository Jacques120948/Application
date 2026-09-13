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
    maxProjects: 5,
    maxConnections: 3,
    storageMegabytes: 250,
    monthlyCredits: 350,
    radarRunsPerMonth: 4,
    liaAnswersPerMonth: 500,
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
