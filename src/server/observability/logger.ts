/**
 * Journalisation structurée, une ligne JSON par événement.
 *
 * Aucune donnée sensible n'est journalisée : ni mot de passe, ni jeton, ni clé, ni
 * contenu intégral d'un message utilisateur. Les identifiants sont journalisés, les
 * adresses e-mail ne le sont pas.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'apiKey',
  'secret',
  'authorization',
  'cookie',
  'email',
])

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[profondeur maximale]'
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key) ? '[masqué]' : sanitize(item, depth + 1)
  }
  return out
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? { context: sanitize(context) } : {}),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    process.env.NODE_ENV !== 'production' ? emit('debug', message, context) : undefined,
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
}
