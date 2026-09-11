import { describe, expect, it } from 'vitest'
import { computeJourney, type JourneyFacts } from '@/server/business/journey'

const nothing: JourneyFacts = {
  locale: 'fr',
  hasProfile: false,
  guidedPath: true,
  hasIdea: false,
  ideaValidated: false,
  specSheetReady: false,
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
    expect(
      computeJourney({ ...nothing, hasProfile: true, hasIdea: true, ideaValidated: true }).next?.id,
    ).toBe('cahier')
  })

  it('donne un avancement chiffré', () => {
    const journey = computeJourney({
      ...nothing,
      hasProfile: true,
      hasIdea: true,
      ideaValidated: true,
      specSheetReady: true,
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
      specSheetReady: true,
      projectId: 'p1',
      hasBuild: true,
      testedWithoutError: true,
      monetizationDecided: true,
      published: true,
    })
    expect(journey.progress).toBe(100)
    expect(journey.next).toBeNull()
  })

  /*
   * Le créateur qui entre par « je sais ce que je veux créer » n'a pas de profil. Son
   * parcours doit rester lisible : l'objectif lui est proposé, jamais imposé, et les
   * étapes liées aux idées proposées n'ont pas de sens pour lui.
   */
  it('reste cohérent pour un créateur entré par le chemin direct', () => {
    const journey = computeJourney({
      locale: 'fr',
      hasProfile: false,
      guidedPath: false,
      hasIdea: true,
      ideaValidated: false,
      specSheetReady: false,
      projectId: 'p1',
      hasBuild: true,
      testedWithoutError: false,
      monetizationDecided: false,
      published: false,
    })

    const skipped = journey.steps.filter((step) => step.skipped).map((step) => step.id)
    expect(skipped).toContain('idee')
    expect(skipped).toContain('validation')

    // L'objectif reste une étape ouverte : il apporte le chiffrage, il ne bloque rien.
    const objectif = journey.steps.find((step) => step.id === 'objectif')
    expect(objectif?.done).toBe(false)
    expect(objectif?.skipped).toBeUndefined()

    expect(journey.next).not.toBeNull()
  })
})
