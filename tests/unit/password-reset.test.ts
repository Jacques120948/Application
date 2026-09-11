import { describe, expect, it } from 'vitest'
import { resetConfirmInput, resetRequestInput } from '@/server/auth/password-reset'
import { legalIdentityInput } from '@/server/settings/legal'

/**
 * La réinitialisation est le parcours par lequel on prend un compte quand il est mal
 * fait. Ces tests fixent ce que la validation accepte avant même d'atteindre la base.
 */
describe('demande de réinitialisation', () => {
  it('normalise l’adresse', () => {
    expect(resetRequestInput.parse({ email: '  Jean@Exemple.CH ' }).email).toBe(
      'jean@exemple.ch',
    )
  })

  it('refuse une adresse qui n’en est pas une', () => {
    expect(() => resetRequestInput.parse({ email: 'pas-une-adresse' })).toThrow()
  })
})

describe('changement de mot de passe', () => {
  it('refuse un jeton trop court pour être sérieux', () => {
    expect(() => resetConfirmInput.parse({ token: 'abc', password: 'motdepasse-1' })).toThrow()
  })

  it('accepte un jeton de la taille produite par le serveur', () => {
    const token = 'a'.repeat(43)
    expect(() => resetConfirmInput.parse({ token, password: 'motdepasse-1' })).not.toThrow()
  })
})

describe('identité légale', () => {
  it('accepte des champs vides, une installation neuve n’a rien à déclarer', () => {
    expect(() => legalIdentityInput.parse({})).not.toThrow()
  })

  it('borne la longueur des champs', () => {
    expect(() => legalIdentityInput.parse({ entity: 'x'.repeat(200) })).toThrow()
  })
})
