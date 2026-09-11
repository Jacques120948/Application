import { describe, expect, it, beforeEach } from 'vitest'
import {
  assertPasswordAcceptable,
  hashPassword,
  verifyPassword,
} from '@/server/auth/password'
import { clearAll, consume, RULES } from '@/server/auth/rate-limit'
import { costMicros } from '@/server/ai/routing'
import { creditsForCost, MINIMUM_COST } from '@/server/billing/credits'
import { AppError } from '@/lib/errors'

describe('mots de passe', () => {
  it('produit une empreinte différente à chaque appel pour le même mot de passe', async () => {
    const a = await hashPassword('motdepasse-42')
    const b = await hashPassword('motdepasse-42')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt$')).toBe(true)
  })

  it('vérifie correctement un mot de passe', async () => {
    const stored = await hashPassword('motdepasse-42')
    expect(await verifyPassword('motdepasse-42', stored)).toBe(true)
    expect(await verifyPassword('motdepasse-43', stored)).toBe(false)
  })

  it('ne lève pas sur une empreinte malformée', async () => {
    expect(await verifyPassword('peu importe', 'nimporte-quoi')).toBe(false)
    expect(await verifyPassword('peu importe', '')).toBe(false)
  })

  it('refuse un mot de passe trop court ou sans chiffre ni symbole', () => {
    expect(() => assertPasswordAcceptable('court1')).toThrow(AppError)
    expect(() => assertPasswordAcceptable('quesdeslettres')).toThrow(AppError)
    expect(() => assertPasswordAcceptable('motdepasse-42')).not.toThrow()
  })
})

describe('limitation de débit', () => {
  beforeEach(() => clearAll())

  it('bloque après le nombre autorisé de tentatives', () => {
    for (let index = 0; index < RULES.login.limit; index += 1) {
      expect(() => consume('test:ip', RULES.login)).not.toThrow()
    }
    expect(() => consume('test:ip', RULES.login)).toThrow(AppError)
  })

  it('compte séparément deux clés différentes', () => {
    for (let index = 0; index < RULES.login.limit; index += 1) consume('cle-a', RULES.login)
    expect(() => consume('cle-b', RULES.login)).not.toThrow()
  })
})

describe('coût des opérations IA', () => {
  it('facture les jetons lus en cache moins cher que les jetons neufs', () => {
    const neuf = costMicros('claude-opus-5', {
      inputTokens: 1000,
      outputTokens: 0,
      cachedTokens: 0,
    })
    const cache = costMicros('claude-opus-5', {
      inputTokens: 1000,
      outputTokens: 0,
      cachedTokens: 1000,
    })
    expect(cache).toBeLessThan(neuf)
  })

  it('applique un plancher par opération', () => {
    expect(creditsForCost('generate', 0)).toBe(MINIMUM_COST.generate)
    expect(creditsForCost('edit', 500_000)).toBe(500)
  })

  it('renvoie zéro pour un modèle inconnu plutôt que de planter', () => {
    expect(costMicros('modele-inexistant', { inputTokens: 10, outputTokens: 10, cachedTokens: 0 })).toBe(0)
  })
})
