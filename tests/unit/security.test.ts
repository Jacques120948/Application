import { describe, expect, it, beforeEach } from 'vitest'
import {
  assertPasswordAcceptable,
  hashPassword,
  verifyPassword,
} from '@/server/auth/password'
import { clearAll, consume, RULES } from '@/server/auth/rate-limit'
import {
  costMicros,
  creditsFor,
  DEFAULT_COST_MULTIPLIER,
  DEFAULT_IMAGE_MICROS,
  DEFAULT_MICROS_PER_CREDIT,
  DEFAULT_MODEL_PRICING,
  type PricingTable,
} from '@/server/billing/ai-pricing'
import { MINIMUM_COST } from '@/server/billing/credits'
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
  /*
   * Les tarifs se règlent désormais depuis l'administration. Ce test travaille sur la
   * table de secours écrite dans le code, qui est celle qui s'applique tant que rien n'a
   * été réglé : c'est donc bien le comportement livré qui est vérifié, sans base.
   */
  const TABLE: PricingTable = {
    prices: DEFAULT_MODEL_PRICING,
    multiplier: DEFAULT_COST_MULTIPLIER,
    microsPerCredit: DEFAULT_MICROS_PER_CREDIT,
    imageMicros: DEFAULT_IMAGE_MICROS,
  }

  it('facture les jetons lus en cache moins cher que les jetons neufs', () => {
    const neuf = costMicros('claude-opus-5', { inputTokens: 1000, outputTokens: 0, cachedTokens: 0 }, TABLE)
    const cache = costMicros('claude-opus-5', { inputTokens: 1000, outputTokens: 0, cachedTokens: 1000 }, TABLE)
    expect(cache).toBeLessThan(neuf)
  })

  it('garde les tarifs publiés par Anthropic', () => {
    // Un million de jetons d'entrée sur Opus : 5 USD, soit 5 000 000 de micro-dollars.
    expect(costMicros('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 }, TABLE)).toBe(
      5_000_000,
    )
    expect(costMicros('claude-opus-5', { inputTokens: 0, outputTokens: 1_000_000, cachedTokens: 0 }, TABLE)).toBe(
      25_000_000,
    )
  })

  it('applique un plancher par opération', () => {
    expect(creditsFor(0, MINIMUM_COST.generate, TABLE)).toBe(MINIMUM_COST.generate)
    // Au-delà du plancher, le coût réel commande : 500 000 micro-dollars à 5 000 le crédit.
    expect(creditsFor(500_000, MINIMUM_COST.edit, TABLE)).toBe(100)
  })

  it('facture une génération complète dans l’ordre de grandeur du modèle tarifaire', () => {
    // Coût mesuré d'une application complète : environ 0,105 USD.
    expect(creditsFor(105_000, MINIMUM_COST.generate, TABLE)).toBe(21)
  })

  it('applique la marge, et ne change rien quand elle vaut 1', () => {
    expect(creditsFor(105_000, 0, { ...TABLE, multiplier: 1 })).toBe(21)
    expect(creditsFor(105_000, 0, { ...TABLE, multiplier: 2 })).toBe(42)
  })

  it('renvoie zéro pour un modèle inconnu plutôt que de planter', () => {
    expect(
      costMicros('modele-inexistant', { inputTokens: 10, outputTokens: 10, cachedTokens: 0 }, TABLE),
    ).toBe(0)
  })
})

describe("code d'accès à l'inscription", () => {
  beforeEach(() => clearAll())

  it("laisse l'inscription ouverte quand aucun code n'est défini", async () => {
    delete process.env.SIGNUP_CODE
    const { registerInput } = await import('@/server/auth/service')
    expect(registerInput.parse({ email: 'a@b.fr', password: 'motdepasse-42' })).toMatchObject({
      email: 'a@b.fr',
    })
  })

  it('refuse un code absent ou faux quand un code est exigé', async () => {
    process.env.SIGNUP_CODE = 'sesame-2026'
    const { register } = await import('@/server/auth/service')

    await expect(
      register(
        { email: `${Date.now()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
        { ip: `sans-code-${Date.now()}` },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    await expect(
      register(
        {
          email: `${Date.now()}@exemple.test`,
          password: 'motdepasse-42',
          locale: 'fr',
          invitationCode: 'mauvais',
        },
        { ip: `faux-code-${Date.now()}` },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    delete process.env.SIGNUP_CODE
  })
})
