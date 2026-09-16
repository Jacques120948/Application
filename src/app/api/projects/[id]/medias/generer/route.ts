import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getProject } from '@/server/projects/service'
import { addMedia } from '@/server/media/service'
import { CREATOR_ORIGIN, EVOLIIA_ORIGIN, requestImage } from '@/server/media/generate'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 120

const input = z.object({ prompt: z.string().trim().min(5).max(600) })

/**
 * Une image créée par l'IA, rangée dans la bibliothèque du créateur.
 *
 * Deux temps volontairement séparés : l'appel au fournisseur, hors de toute transaction,
 * puis l'enregistrement, qui applique les mêmes contrôles qu'un téléversement.
 *
 * L'origine enregistrée dit qui a payé, et c'est elle qui décomptera le quota mensuel : une
 * image payée par le créateur sur son propre compte ne doit rien consommer de ce qu'Evoliia
 * lui accorde.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    consume(`image-ia:${user.id}`, RULES.aiOperation)
    const { prompt } = input.parse(await readJson(request))

    const project = await getProject(user.id, id)
    const image = await requestImage(user.id, prompt, project.spec)
    const media = await addMedia(user.id, id, {
      name: `ia-${prompt.slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.webp`,
      bytes: image.bytes,
      origin: image.source === 'evoliia' ? EVOLIIA_ORIGIN : CREATOR_ORIGIN,
      prompt: image.prompt,
    })
    return ok({
      media,
      provider: image.provider,
      source: image.source,
      creditsSpent: image.creditsSpent,
    })
  } catch (error) {
    return fail(error)
  }
}
