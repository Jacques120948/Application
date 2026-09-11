import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { confirmPasswordReset, requestPasswordReset } from '@/server/auth/password-reset'
import { AppError } from '@/lib/errors'

/**
 * Réinitialisation du mot de passe, sur une vraie base.
 *
 * Le jeton n'est lisible que dans l'e-mail : ces tests vérifient donc ce qui se passe en
 * base, et surtout ce qui ne s'y passe pas quand l'adresse est inconnue.
 */

let email: string
let userId: string

beforeAll(async () => {
  clearAll()
  email = `reset-${Date.now()}@exemple.test`
  const created = await register({
    email,
    password: 'motdepasse-2026-solide',
    locale: 'fr',
  })
  userId = created.userId
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('demande de réinitialisation', () => {
  it('crée un jeton pour un compte existant', async () => {
    await requestPasswordReset(email, { ip: '203.0.113.10' })
    const tokens = await prisma.verificationToken.findMany({
      where: { userId, purpose: 'PASSWORD_RESET', consumedAt: null },
    })
    expect(tokens).toHaveLength(1)
    // Le jeton n'est jamais stocké en clair : seule une empreinte hexadécimale figure.
    expect(tokens[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ne laisse qu’un seul lien vivant : une nouvelle demande annule la précédente', async () => {
    await requestPasswordReset(email, { ip: '203.0.113.11' })
    const alive = await prisma.verificationToken.count({
      where: { userId, purpose: 'PASSWORD_RESET', consumedAt: null },
    })
    expect(alive).toBe(1)
  })

  it('ne crée rien pour une adresse inconnue, et ne le fait pas savoir', async () => {
    const before = await prisma.verificationToken.count()
    await expect(
      requestPasswordReset(`inconnu-${Date.now()}@exemple.test`, { ip: '203.0.113.12' }),
    ).resolves.toBeUndefined()
    expect(await prisma.verificationToken.count()).toBe(before)
  })
})

describe('changement de mot de passe', () => {
  it('refuse un jeton inventé', async () => {
    await expect(
      confirmPasswordReset('jeton-invente-mais-assez-long-pour-passer', 'motdepasse-2026', {
        ip: '203.0.113.13',
      }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('refuse un mot de passe trop faible avant même de regarder le jeton', async () => {
    await expect(
      confirmPasswordReset('jeton-invente-mais-assez-long-pour-passer', 'court', {
        ip: '203.0.113.14',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})
