import { timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { fail } from './respond'

/**
 * Le contrôle d'entrée des routes appelées par un planificateur.
 *
 * Écrit une fois plutôt que recopié dans chaque route. Deux raisons, et la seconde a déjà
 * coûté une panne silencieuse ailleurs : une vérification de jeton recopiée finit par
 * diverger, et celle-ci est la seule chose qui sépare une tâche interne d'Internet.
 *
 * Trois décisions.
 *
 * **Sans jeton configuré, la route n'existe pas.** Elle répond « introuvable » plutôt que
 * « non autorisé » : une porte fermée ne s'annonce pas, et un 401 confirme une adresse à
 * qui la cherche.
 *
 * **La comparaison est à temps constant.** Un `===` sur un secret fuit sa longueur et son
 * préfixe par le temps qu'il met à répondre. Le coût d'écrire l'autre version est nul.
 *
 * **Le jeton se lit dans l'en-tête `Authorization`.** C'est l'en-tête que Vercel remplit
 * tout seul avec `CRON_SECRET` sur ses tâches planifiées, ce qui évite d'inventer une
 * convention que l'hébergeur ne saurait pas suivre.
 */
export function refusCron(request: Request): Response | null {
  const secret = env.cronSecret
  if (secret === undefined) return new Response(null, { status: 404 })

  const fourni = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(fourni)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return fail(new AppError('UNAUTHENTICATED', 'Jeton invalide.'))
  }
  return null
}
