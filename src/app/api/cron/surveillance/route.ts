import { z } from 'zod'
import { runScheduledWatch } from '@/server/audit/surveillance'
import { refusCron } from '@/server/http/cron'
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
 *
 * **Deux verbes, parce que deux appelants.** Les tâches planifiées de Vercel appellent en
 * `GET`, sans corps : déclarée en `POST` seulement, la route aurait répondu 405 chaque
 * semaine sans que rien ne le signale — une surveillance en panne ne se plaint pas, c'est
 * précisément ce qui la rend dangereuse. `POST` reste pour un appel à la main ou un
 * planificateur qui sait poser un corps, quand on veut borner le nombre de sites.
 */
async function passer(request: Request, corps: boolean) {
  const refus = refusCron(request)
  if (refus !== null) return refus

  try {
    const body = corps ? input.parse(await readJson(request).catch(() => ({}))) : {}
    return ok(await runScheduledWatch({ limit: body.limit }))
  } catch (error) {
    return fail(error)
  }
}

export async function GET(request: Request) {
  return passer(request, false)
}

export async function POST(request: Request) {
  return passer(request, true)
}
