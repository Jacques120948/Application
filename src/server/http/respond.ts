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

/**
 * L'adresse d'où vient la requête.
 *
 * Elle sert à compter les tentatives de connexion, donc elle décide d'un refus : sa valeur
 * doit venir de l'infrastructure, pas de celui qui frappe à la porte.
 *
 * `x-forwarded-for` est une liste, et sa première entrée est celle que le client a envoyée.
 * Un hébergement sérieux la réécrit, mais rien dans le protocole ne l'y oblige : la lire en
 * premier revient à laisser l'attaquant choisir sous quel nom on le compte, et donc à
 * repartir de zéro à chaque requête. On préfère donc les en-têtes que la plateforme pose
 * elle-même et qu'un client ne peut pas usurper, et on ne retombe sur la liste qu'à défaut.
 *
 * Le compteur par compte, lui, ne dépend d'aucun en-tête : c'est lui qui tient la limite de
 * cinq essais, quoi qu'un attaquant raconte sur son origine.
 */
export function clientIp(request: Request): string | null {
  const plateforme =
    request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-real-ip')
  if (plateforme !== null && plateforme.trim() !== '') return plateforme.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded === null) return null
  /*
   * À défaut, la dernière entrée plutôt que la première : c'est celle ajoutée par le saut le
   * plus proche de nous, donc la moins facile à dicter depuis l'extérieur.
   */
  const entrees = forwarded.split(',').map((entree) => entree.trim()).filter((entree) => entree !== '')
  return entrees[entrees.length - 1] ?? null
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
