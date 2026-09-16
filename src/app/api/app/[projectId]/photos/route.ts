import { resolveRuntimeSpec } from '@/server/runtime/context'
import { addVisitorPhoto } from '@/server/media/service'
import { MAX_UPLOAD_BYTES } from '@/server/media/rules'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertSameOrigin, clientIp, fail, ok } from '@/server/http/respond'
import { notFound, validation } from '@/lib/errors'

/**
 * Photo envoyée depuis un formulaire d'application publiée.
 *
 * Elle part avant que le formulaire ne soit validé, parce qu'il faut bien la montrer à
 * celui qui vient de la choisir. La fiche, ensuite, ne transporte que son identifiant.
 *
 * Trois garde-fous, et chacun répond à une manière précise d'en abuser.
 *
 * **L'application doit déclarer un champ photo.** Sans cela, cette adresse serait un dépôt
 * de fichiers ouvert sur toute application publiée, y compris celles qui ne demandent
 * jamais d'image.
 *
 * **Le rythme est bridé plus sévèrement qu'une saisie ordinaire.** Une fiche pèse un
 * kilooctet, une photo huit mégaoctets : le même plafond pour les deux laisserait remplir
 * en deux minutes un espace acheté pour l'année.
 *
 * **Le poids annoncé est vérifié avant de lire le fichier.** Refuser après avoir tout
 * chargé en mémoire serait refuser trop tard.
 *
 * La photo est portée par le compte du créateur : c'est son quota de stockage, déjà payé,
 * qui la supporte. Un visiteur ne peut donc pas créer de dépense — au pire remplir une
 * place qui existe, ce qui s'arrête tout seul.
 */
export const maxDuration = 30

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`app-photo:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.appPhoto)

    const declared = Number(request.headers.get('content-length') ?? '0')
    if (declared > MAX_UPLOAD_BYTES + 4096) {
      throw validation("Cette photo est trop lourde. Réduisez-la avant de l'envoyer.")
    }

    const runtime = await resolveRuntimeSpec(projectId)
    const attendue = runtime.spec.dataModels.some((model) =>
      model.fields.some((field) => field.type === 'photo'),
    )
    if (!attendue) throw notFound("Cette application ne reçoit pas de photos.")

    const form = await request.formData()
    const file = form.get('photo')
    if (!(file instanceof File)) throw validation('Aucune photo reçue.')

    const photo = await addVisitorPhoto({
      ownerId: runtime.ownerId,
      projectId: runtime.projectId,
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    return ok({ photo }, 201)
  } catch (error) {
    return fail(error)
  }
}
