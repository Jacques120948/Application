import { z } from 'zod'
import { tournerQuotidien } from '@/server/audit/automatisation'
import { envoyerBilansLina } from '@/server/lina/bilan-email'
import { isEnabled } from '@/server/settings/flags'
import { refusCron } from '@/server/http/cron'
import { fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 300

const input = z.object({ limit: z.number().int().min(1).max(200).optional() })

/**
 * Point d'entrée du planificateur pour la tournée quotidienne.
 *
 * Trois verrous avant qu'une seule ligne ne s'exécute : le jeton du planificateur, sans
 * lequel la route répond « introuvable » comme si elle n'existait pas ; le drapeau
 * `automatisation`, éteint par défaut, qui permet de tout arrêter depuis l'administration
 * sans déployer ; et, pour chaque site, les réglages que la personne a elle-même allumés.
 *
 * Un planificateur mal réglé qui appellerait toutes les heures ne produirait donc rien de
 * plus : le rythme de rédaction est vérifié site par site, et c'est lui qui décide.
 *
 * `GET` parce que les tâches planifiées de Vercel appellent en `GET`, sans corps. Déclarée
 * en `POST` seulement, la route aurait répondu 405 chaque nuit sans que rien ne le
 * signale — et une automatisation en panne ne se plaint jamais.
 */
async function passer(request: Request, corps: boolean) {
  const refus = refusCron(request)
  if (refus !== null) return refus

  try {
    /*
     * Le bilan de Lina a son propre interrupteur et ses propres opt-in : il passe avant la
     * tournée des sites, et une panne de l'un n'empêche pas l'autre.
     */
    const lina = await envoyerBilansLina().catch(() => ({ examines: 0, envoyes: 0, ignores: 0, raison: 'échec' }))
    if (!(await isEnabled('automatisation'))) {
      return ok({ sites: 0, indexations: 0, releves: 0, articles: 0, depots: 0, echecs: 0, lina })
    }
    const body = corps ? input.parse(await readJson(request).catch(() => ({}))) : {}
    return ok({ ...(await tournerQuotidien(body.limit)), lina })
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
