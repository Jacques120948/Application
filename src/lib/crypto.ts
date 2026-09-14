import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from './env'
import { AppError } from './errors'

/**
 * Chiffrement des secrets confiés par les créateurs.
 *
 * Concerne les jetons OAuth et les clés d'API de leurs propres comptes. Ces valeurs ne
 * nous appartiennent pas : une fuite donnerait accès au Drive ou au compte Stripe de
 * quelqu'un d'autre. Elles ne sont donc jamais écrites en clair, ni en base, ni ailleurs.
 *
 * AES-256-GCM : chiffrement et authentification en une seule opération. Un texte modifié
 * en base ne se déchiffre pas, il échoue — ce qui vaut mieux qu'un jeton silencieusement
 * corrompu.
 *
 * Format stocké, auto-descriptif pour permettre un changement d'algorithme sans perdre
 * l'existant :
 *
 *   v1.<nonce base64url>.<étiquette base64url>.<chiffré base64url>
 */

const VERSION = 'v1'
const NONCE_LENGTH = 12

/**
 * La clé de 32 octets est dérivée de ENCRYPTION_KEY par SHA-256.
 *
 * Cela évite d'imposer une longueur exacte à l'exploitant : n'importe quelle phrase
 * suffisamment longue devient une clé valide, sans jamais raccourcir ni compléter la
 * valeur fournie, ce qui affaiblirait le chiffrement.
 */
function key(): Buffer {
  const secret = env.encryptionKey
  if (secret.length < 32) {
    throw new AppError('INTERNAL', 'ENCRYPTION_KEY doit faire au moins 32 caractères.')
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}

/**
 * Vérifie que le chiffrement est possible avant d'engager quoi que ce soit chez un
 * fournisseur. Créer un compte Stripe puis échouer à en garder l'identifiant laisserait
 * un compte orphelin ; mieux vaut refuser avant.
 */
export function assertEncryptionReady(): void {
  key()
}

export function encryptSecret(plaintext: string): string {
  const nonce = randomBytes(NONCE_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    VERSION,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

export function decryptSecret(stored: string): string {
  const parts = stored.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new AppError('INTERNAL', 'Secret illisible : format inattendu.')
  }
  const [, rawNonce, rawTag, rawPayload] = parts
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(rawNonce as string, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(rawTag as string, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(rawPayload as string, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // Ni le contenu ni la clé ne doivent apparaître dans le message : il finit en journal.
    throw new AppError('INTERNAL', 'Secret illisible : déchiffrement impossible.')
  }
}

/**
 * Indice affiché au créateur pour qu'il reconnaisse sa clé sans qu'elle soit révélée.
 * Quatre caractères ne permettent pas de reconstituer une clé, mais suffisent à la
 * distinguer d'une autre.
 */
export function secretHint(plaintext: string): string {
  return plaintext.length <= 4 ? '••••' : `••••${plaintext.slice(-4)}`
}
