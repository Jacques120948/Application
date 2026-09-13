import { describe, expect, it } from 'vitest'
import {
  anySignalSourceConfigured,
  collectSignals,
  describeSignals,
  signalSourcesStatus,
} from '@/server/radar/signals'

/**
 * Les sources de signaux du Radar V2, sans aucune clé configurée : c'est l'état de toute
 * installation tant que le propriétaire n'a pas décidé d'en brancher une.
 */
describe('signaux extérieurs du Radar', () => {
  it('déclare chaque source absente et dit ce qu’elle attend', () => {
    const status = signalSourcesStatus()
    expect(status.length).toBeGreaterThanOrEqual(2)
    for (const source of status) {
      expect(source.configured).toBe(false)
      expect(source.requires.length).toBeGreaterThan(0)
      for (const name of source.requires) expect(process.env[name]).toBeUndefined()
    }
    expect(anySignalSourceConfigured()).toBe(false)
  })

  it('ne collecte rien, n’appelle rien et n’écrit rien sans source configurée', async () => {
    const signals = await collectSignals('00000000-0000-0000-0000-000000000000', {
      topic: 'coiffure',
      locale: 'fr',
      scope: 'francophone',
    })
    expect(signals).toEqual([])
  })

  it('décrit un signal comme une observation datée, avec sa confiance', () => {
    const lines = describeSignals([
      {
        type: 'search_trend',
        summary: 'Les recherches « prise de rendez-vous coiffeur » progressent.',
        url: null,
        confidence: 60,
        observedAt: new Date('2026-09-01T10:00:00Z'),
      },
    ])
    expect(lines).toEqual([
      '[search_trend, confiance 60/100, 2026-09-01] Les recherches « prise de rendez-vous coiffeur » progressent.',
    ])
  })
})
