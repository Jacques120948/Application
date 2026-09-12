import { describe, expect, it } from 'vitest'
import { describeReason } from '@/server/business/stats'

/**
 * Lecture du registre de crédits.
 *
 * Un solde qui baisse sans explication ressemble à une fuite. Le registre garde des motifs
 * techniques, utiles au code ; ce qui s'affiche doit être une phrase, y compris pour un
 * motif que le code d'aujourd'hui ne connaît pas encore.
 */
describe('motifs de dépense', () => {
  it('traduit les opérations connues', () => {
    expect(describeReason('ia:generate')).toBe('Construction d’une application')
    expect(describeReason('ia:launchKit')).toBe('Kit de lancement marketing')
    expect(describeReason('grant:inscription')).toBe('Crédits de bienvenue')
  })

  it('reconnaît une recharge quelle que soit l’offre', () => {
    expect(describeReason('grant:mensuel:builder')).toBe('Recharge mensuelle')
    expect(describeReason('grant:mensuel:business')).toBe('Recharge mensuelle')
    expect(describeReason('grant:offre:launch')).toBe('Changement d’offre')
  })

  it('n’invente rien pour un motif inconnu', () => {
    // Mieux vaut afficher le motif brut qu'une phrase inventée qui décrirait mal la dépense.
    expect(describeReason('ia:futur')).toBe('ia:futur')
  })
})
