import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { addMedia, listMedias, removeMedia } from '@/server/media/service'
import { MAX_UPLOAD_BYTES } from '@/server/media/rules'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { validation } from '@/lib/errors'

export const maxDuration = 30

const deleteInput = z.object({ mediaId: z.string().uuid() })

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok(await listMedias(user.id, id))
  } catch (error) {
    return fail(error)
  }
}

/**
 * Téléversement.
 *
 * Le corps est lu en formulaire multipart plutôt qu'en JSON : encoder une image en base64
 * la gonflerait d'un tiers pour rien. La taille est vérifiée avant de charger le fichier en
 * mémoire, et le type annoncé par le navigateur n'est jamais cru sur parole.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params

    const declared = Number(request.headers.get('content-length') ?? '0')
    if (declared > MAX_UPLOAD_BYTES + 4096) {
      throw validation("Cette image est trop lourde. Réduisez-la avant de l'envoyer.")
    }

    const form = await request.formData()
    const file = form.get('image')
    if (!(file instanceof File)) throw validation('Aucune image reçue.')

    const bytes = new Uint8Array(await file.arrayBuffer())
    return ok({ media: await addMedia(user.id, id, { name: file.name, bytes }) })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { mediaId } = deleteInput.parse(await readJson(request))
    await removeMedia(user.id, mediaId)
    return ok({ deleted: true })
  } catch (error) {
    return fail(error)
  }
}
