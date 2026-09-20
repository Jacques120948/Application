import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import {
  ajouterPrompt,
  basculerPrompt,
  proposerQuestions,
  releverVisibilite,
  supprimerPrompt,
} from '@/server/audit/visibilite-ia'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/**
 * Les questions suivies, et le relevé lui-même.
 *
 * Une seule route pour quatre gestes, distingués par `geste` : ajouter, allumer, retirer,
 * relever. Ils portent tous sur le même objet et le même droit ; les éclater en quatre
 * adresses aurait multiplié les points à protéger sans rien clarifier.
 *
 * `relever` est la seule qui dépense. Elle est bornée en durée parce qu'elle interroge
 * plusieurs assistants en série, et en fréquence parce qu'un double clic ne doit pas payer
 * deux fois.
 */
export const maxDuration = 300

const input = z.discriminatedUnion('geste', [
  z.object({
    geste: z.literal('ajouter'),
    texte: z.string().min(8).max(300),
    theme: z.string().max(60).optional(),
  }),
  z.object({ geste: z.literal('basculer'), promptId: z.string().uuid(), actif: z.boolean() }),
  z.object({ geste: z.literal('retirer'), promptId: z.string().uuid() }),
  z.object({ geste: z.literal('relever') }),
  z.object({ geste: z.literal('proposer'), locale: z.string().max(5).optional() }),
])

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { siteId } = await context.params
    const demande = input.parse(await readJson(request))

    if (demande.geste === 'relever') {
      consume(`visibilite-ia:${user.id}`, RULES.aiOperation)
      return ok({ bilan: await releverVisibilite(user.id, siteId) })
    }

    if (demande.geste === 'proposer') {
      consume(`visibilite-ia:proposer:${user.id}`, RULES.aiOperation)
      return ok({
        questions: await proposerQuestions(user.id, siteId, demande.locale ?? 'fr'),
      })
    }

    consume(`visibilite-ia:prompts:${user.id}`, RULES.aiOperation)
    if (demande.geste === 'ajouter') {
      return ok({
        prompt: await ajouterPrompt(user.id, siteId, demande.texte, demande.theme ?? ''),
      })
    }
    if (demande.geste === 'basculer') {
      await basculerPrompt(user.id, demande.promptId, demande.actif)
      return ok({ bascule: true })
    }
    await supprimerPrompt(user.id, demande.promptId)
    return ok({ retire: true })
  } catch (error) {
    return fail(error)
  }
}
