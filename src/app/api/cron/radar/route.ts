import { z } from 'zod'
import { runScheduledRadar } from '@/server/radar/scheduled'
import { refusCron } from '@/server/http/cron'
import { fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 300

const input = z.object({ limit: z.number().int().min(1).max(200).optional() })

/**
 * Point d'entrée du planificateur pour le Radar périodique.
 *
 * Il n'y a pas de tâche planifiée dans Evoliia : c'est l'hébergeur (une tâche cron, un
 * appel externe) qui appelle cette route une fois par jour avec le jeton. Sans jeton
 * configuré, la route répond « introuvable », comme si elle n'existait pas — on ne
 * révèle pas une porte fermée.
 */
export async function POST(request: Request) {
  const refus = refusCron(request)
  if (refus !== null) return refus

  try {
    const body = input.parse(await readJson(request).catch(() => ({})))
    return ok(await runScheduledRadar({ limit: body.limit }))
  } catch (error) {
    return fail(error)
  }
}
