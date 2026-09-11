import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { validation } from '@/lib/errors'

/**
 * Hachage de mot de passe par scrypt (fonction de dérivation à coût mémoire, résistante
 * aux attaques matérielles). Format stocké, auto-descriptif pour permettre une
 * augmentation future des paramètres sans invalider les comptes existants :
 *
 *   scrypt$N$r$p$<sel base64>$<empreinte base64>
 */

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const
const KEY_LENGTH = 64
const SALT_LENGTH = 16

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 200

/** Contrôle de robustesse volontairement simple et explicable à un débutant. */
export function assertPasswordAcceptable(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw validation(`Votre mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`)
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw validation('Votre mot de passe est trop long.')
  }
  const hasLetter = /\p{L}/u.test(password)
  const hasOther = /[^\p{L}]/u.test(password)
  if (!hasLetter || !hasOther) {
    throw validation('Ajoutez au moins un chiffre ou un symbole à votre mot de passe.')
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS)
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  const salt = Buffer.from(rawSalt ?? '', 'base64')
  const expected = Buffer.from(rawHash ?? '', 'base64')
  if (salt.length === 0 || expected.length === 0) return false

  const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: PARAMS.maxmem,
  })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
