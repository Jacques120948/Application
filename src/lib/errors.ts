/**
 * Erreurs applicatives typées.
 *
 * Chaque erreur porte un code stable (exploitable par le client et les journaux) et un
 * message destiné à l'utilisateur final, rédigé sans jargon technique. Le détail
 * technique reste dans `cause`, qui n'est jamais renvoyé au navigateur.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_CREDITS'
  | 'PLAN_LIMIT'
  | 'AI_UNAVAILABLE'
  | 'AI_REFUSED'
  /** Le compte extérieur d'un créateur a refusé l'appel : clé invalide, crédit épuisé. */
  | 'CREATOR_KEY_REJECTED'
  | 'UNSUPPORTED_REQUEST'
  | 'INTERNAL'

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_CREDITS: 402,
  PLAN_LIMIT: 402,
  AI_UNAVAILABLE: 503,
  AI_REFUSED: 422,
  CREATOR_KEY_REJECTED: 503,
  UNSUPPORTED_REQUEST: 422,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = options?.details
  }
}

export const unauthenticated = (message = "Vous devez être connecté pour continuer.") =>
  new AppError('UNAUTHENTICATED', message)

/**
 * Utilisé aussi lorsqu'une ressource existe mais appartient à quelqu'un d'autre :
 * répondre « introuvable » évite de confirmer son existence.
 */
export const notFound = (message = "Cet élément est introuvable.") =>
  new AppError('NOT_FOUND', message)

export const validation = (message: string, details?: Record<string, unknown>) =>
  new AppError('VALIDATION', message, details ? { details } : undefined)

export const conflict = (message: string) => new AppError('CONFLICT', message)

export const rateLimited = (message = "Trop de tentatives. Réessayez dans un instant.") =>
  new AppError('RATE_LIMITED', message)

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/** Traduit n'importe quelle exception en réponse sûre pour le navigateur. */
export function toPublicError(error: unknown): {
  code: AppErrorCode
  message: string
  status: number
  details?: Record<string, unknown>
} {
  if (isAppError(error)) {
    const base = { code: error.code, message: error.message, status: error.status }
    return error.details ? { ...base, details: error.details } : base
  }
  return {
    code: 'INTERNAL',
    message: "Une erreur inattendue s'est produite. Nous avons été prévenus.",
    status: 500,
  }
}
