import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, toPublicError, validation } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import { isSameOrigin } from '@/server/auth/session'

/**
 * Enveloppe commune des routes HTTP.
 *
 * Les routes ne contiennent pas de logique métier : elles valident, appellent un cas
 * d'usage, traduisent le résultat. Les erreurs internes ne fuient jamais vers le
 * navigateur — seul un message rédigé pour l'utilisateur est renvoyé.
 */

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function fail(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    const first = error.issues[0]
    return NextResponse.json(
      {
        code: 'VALIDATION',
        message: first?.message ?? 'Les informations envoyées ne sont pas valides.',
      },
      { status: 422 },
    )
  }

  const publicError = toPublicError(error)
  if (!(error instanceof AppError)) {
    logger.error('erreur non gérée dans une route', {
      reason: error instanceof Error ? error.message : 'inconnu',
    })
  }
  return NextResponse.json(
    {
      code: publicError.code,
      message: publicError.message,
      ...(publicError.details ? { details: publicError.details } : {}),
    },
    { status: publicError.status },
  )
}

/** Défense CSRF complémentaire de SameSite : toute mutation vérifie l'origine. */
export function assertSameOrigin(request: Request): void {
  if (!isSameOrigin(request)) {
    throw validation("Cette requête n'a pas pu être vérifiée. Rechargez la page.")
  }
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded !== null) return forwarded.split(',')[0]?.trim() ?? null
  return request.headers.get('x-real-ip')
}

/** Lit un corps JSON borné en taille. */
export async function readJson(request: Request, maxBytes = 256 * 1024): Promise<unknown> {
  const text = await request.text()
  if (text.length > maxBytes) throw validation('La requête est trop volumineuse.')
  try {
    return text === '' ? {} : JSON.parse(text)
  } catch {
    throw validation('Les informations envoyées sont illisibles.')
  }
}
