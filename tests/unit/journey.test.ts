import { describe, expect, it } from 'vitest'
import { computeJourney, type JourneyFacts } from '@/server/business/journey'

const nothing: JourneyFacts = {
  locale: 'fr',
  hasProfile: false,
  guidedPath: true,
  hasIdea: false,
  ideaValidated: false,
  projectId: null,
  hasBuild: false,
  testedWithoutError: false,
  monetizationDecided: false,
  published: false,
}

describe('parcours du créateur', () => {
  it('commence par l’objectif, jamais par l’idée', () => {
    const journey = computeJourney(nothing)
    expect(journey.steps[0]?.id).toBe('objectif')
    expect(journey.next?.id).toBe('objectif')
    expect(journey.progress).toBe(0)
  })

  it('propose toujours une action et une raison', () => {
    for (const step of computeJourney(nothing).steps) {
      expect(step.why.length).toBeGreaterThan(10)
      expect(step.action).toBeTruthy()
      expect(step.href).toBeTruthy()
    }
  })

  it('avance étape par étape', () => {
    expect(computeJourney({ ...nothing, hasProfile: true }).next?.id).toBe('idee')
    expect(computeJourney({ ...nothing, hasProfile: true, hasIdea: true }).next?.id).toBe(
      'validation',
    )
  })

  it('donne un avancement chiffré', () => {
    const journey = computeJourney({
      ...nothing,
      hasProfile: true,
      hasIdea: true,
      ideaValidated: true,
      projectId: 'p1',
      hasBuild: true,
    })
    expect(journey.progress).toBeGreaterThan(50)
    expect(journey.progress).toBeLessThan(100)
  })

  it('saute la recherche d’idée pour un créateur venu avec la sienne', () => {
    const journey = computeJourney({
      ...nothing,
      guidedPath: false,
      hasProfile: true,
      projectId: 'p1',
      hasBuild: true,
    })
    expect(journey.steps.find((step) => step.id === 'idee')?.skipped).toBe(true)
    expect(journey.steps.find((step) => step.id === 'validation')?.skipped).toBe(true)
    // La prochaine action porte sur l'application, pas sur une idée qui n'existe pas.
    expect(journey.next?.id).toBe('test')
  })

  it('ne propose plus rien quand tout est fait', () => {
    const journey = computeJourney({
      locale: 'fr',
      hasProfile: true,
      guidedPath: true,
      hasIdea: true,
      ideaValidated: true,
      projectId: 'p1',
      hasBuild: true,
      testedWithoutError: true,
      monetizationDecided: true,
      published: true,
    })
    expect(journey.progress).toBe(100)
    expect(journey.next).toBeNull()
  })
})
