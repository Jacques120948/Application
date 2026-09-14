import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { consume, RULES } from '@/server/auth/rate-limit'
import { getProject } from '@/server/projects/service'
import { addMedia } from '@/server/media/service'
import { requestImage } from '@/server/media/generate'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

export const maxDuration = 120

const input = z.object({ prompt: z.string().trim().min(5).max(600) })

/**
 * Une image générée avec la clé du créateur, rangée dans sa bibliothèque.
 *
 * Deux temps volontairement séparés : l'appel au fournisseur, hors de toute transaction,
 * puis l'enregistrement, qui applique les mêmes contrôles qu'un téléversement.
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
      origin: 'ai',
      prompt: image.prompt,
    })
    return ok({ media, provider: image.provider })
  } catch (error) {
    return fail(error)
  }
}
