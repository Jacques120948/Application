import { describe, expect, it } from 'vitest'
import { describeFailure } from '@/server/ai/operations'

/** Le message d'échec gardé pour le back-office ne doit jamais contenir un secret. */
describe('message d’échec d’un appel IA', () => {
  it('masque les clés et borne la longueur', () => {
    const message = describeFailure(new Error('401 invalid key sk-ant-api03-ABCDEFGHIJKLMNOP Bearer abc.def.ghi AIzaSyABCDEFGHIJKLMNOP'))
    expect(message).not.toContain('ABCDEFGHIJKLMNOP')
    expect(message).not.toContain('abc.def.ghi')
    expect(message).toContain('sk-…')
    expect(message).toContain('AIza…')
    expect(describeFailure(new Error('x'.repeat(1000))).length).toBeLessThanOrEqual(300)
  })

  it('accepte autre chose qu’une erreur', () => {
    expect(describeFailure('panne')).toBe('panne')
  })
})
