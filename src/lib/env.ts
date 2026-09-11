/**
 * Accès aux variables d'environnement, validé et centralisé.
 *
 * Règle de sécurité : aucune valeur lue ici n'est destinée au navigateur. Les variables
 * publiques passent exclusivement par le préfixe NEXT_PUBLIC_ et ne transitent pas par
 * ce module.
 */
import { AppError } from './errors'

function read(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function required(name: string): string {
  const value = read(name)
  if (value === undefined) {
    throw new AppError('INTERNAL', `Variable d'environnement manquante : ${name}`)
  }
  return value
}

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL')
  },
  get sessionSecret(): string {
    const secret = required('SESSION_SECRET')
    if (secret.length < 32) {
      throw new AppError('INTERNAL', 'SESSION_SECRET doit faire au moins 32 caractères.')
    }
    return secret
  },
  get encryptionKey(): string {
    return required('ENCRYPTION_KEY')
  },
  get anthropicApiKey(): string | undefined {
    return read('ANTHROPIC_API_KEY')
  },
  get appUrl(): string {
    return read('APP_URL') ?? 'http://localhost:3000'
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  },
  /** Vrai quand les appels IA réels sont possibles. Voir src/server/ai/client.ts. */
  get aiEnabled(): boolean {
    return read('ANTHROPIC_API_KEY') !== undefined
  },
}
