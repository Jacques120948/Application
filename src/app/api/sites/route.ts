import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { addSite, listSites, startAudit } from '@/server/audit/service'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les sites suivis par un créateur.
 *
 * Ajouter un site et lancer son premier audit sont le même geste vu de l'écran : personne
 * n'ajoute une adresse pour la regarder dormir. La route fait donc les deux, et rend
 * l'identifiant de l'audit ouvert — que l'écran fera avancer, tranche par tranche.
 */
const input = z.object({
  url: z.string().min(1).max(400),
  label: z.string().max(120).optional(),
  about: z.string().max(500).optional(),
})

export async function GET() {
  try {
    const user = await requireUser()
    return ok({ sites: await listSites(user.id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    consume(`audit:${user.id}`, RULES.auditStart)
    const body = input.parse(await readJson(request))

    const site = await addSite(user.id, body)
    const audit = await startAudit(user.id, site.siteId)
    return ok({ siteId: site.siteId, host: site.host, auditId: audit.auditId }, 201)
  } catch (error) {
    return fail(error)
  }
}
