import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { runScheduledWatch } from '@/server/audit/surveillance'
import { fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 300

const input = z.object({ limit: z.number().int().min(1).max(200).optional() })

/**
 * Point d'entrée du planificateur pour la surveillance hebdomadaire.
 *
 * Il n'y a pas de tâche planifiée dans Evoliia : c'est l'hébergeur qui appelle cette route
 * avec le jeton. Sans jeton configuré, la route répond « introuvable », comme si elle
 * n'existait pas — on ne révèle pas une porte fermée.
 *
 * Deux verrous de plus en aval : le drapeau `surveillance`, éteint par défaut, et le délai
 * d'une semaine entre deux contrôles d'un même site. Un planificateur mal réglé qui
 * appellerait toutes les heures ne contrôlerait donc rien de plus qu'une fois par semaine.
 */
export async function POST(request: Request) {
  const secret = env.cronSecret
  if (secret === undefined) return new Response(null, { status: 404 })

  const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return fail(new AppError('UNAUTHENTICATED', 'Jeton invalide.'))
  }

  try {
    const body = input.parse(await readJson(request).catch(() => ({})))
    return ok(await runScheduledWatch({ limit: body.limit }))
  } catch (error) {
    return fail(error)
  }
}
