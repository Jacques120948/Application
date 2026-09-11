import { describe, expect, it } from 'vitest'
import { coachInput } from '@/server/business/coach'
import { MINIMUM_COST } from '@/server/billing/credits'

/**
 * Le coach est appelé depuis le navigateur, sur tous les écrans. Sa validation borne ce
 * qu'un client peut envoyer, et donc ce qu'une question peut coûter.
 */
describe('validation du coach', () => {
  it('accepte une question ordinaire', () => {
    const parsed = coachInput.parse({ question: 'Je fais quoi maintenant ?' })
    expect(parsed.screen).toBe('autre')
    expect(parsed.history).toEqual([])
  })

  it('refuse une question vide ou trop longue', () => {
    expect(() => coachInput.parse({ question: 'a' })).toThrow()
    expect(() => coachInput.parse({ question: 'a'.repeat(601) })).toThrow()
  })

  it('refuse un écran inventé', () => {
    expect(() =>
      coachInput.parse({ question: 'Bonjour, je suis bloqué', screen: 'facturation' }),
    ).toThrow()
  })

  it("borne l'historique renvoyé, pour que le coût d'une question reste borné", () => {
    const turn = { question: 'q', answer: 'r' }
    expect(() =>
      coachInput.parse({ question: 'Et ensuite ?', history: Array(5).fill(turn) }),
    ).toThrow()
    expect(() =>
      coachInput.parse({ question: 'Et ensuite ?', history: Array(4).fill(turn) }),
    ).not.toThrow()
  })

  it('coûte un crédit, comme annoncé dans l’interface', () => {
    expect(MINIMUM_COST.coach).toBe(1)
  })
})
