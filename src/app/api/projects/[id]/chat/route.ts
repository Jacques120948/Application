import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { editWithAgent, editWithAssistant, listChatMessages } from '@/server/projects/service'
import { isEnabled } from '@/server/settings/flags'
import { MAX_ATTACHMENTS } from '@/server/media/service'
import {
  MAX_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  readDocument,
  type AttachedDocument,
} from '@/server/ai/documents'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'
import { validation } from '@/lib/errors'

/**
 * Modification d'une application en langage courant.
 *
 * Une seule adresse pour les deux chemins : l'interrupteur décide lequel répond, et le
 * navigateur n'a pas à le savoir. C'est ce qui permet de revenir en arrière sans rien
 * déployer — et de comparer les deux sur les mêmes demandes.
 *
 * Deux formes de corps, et la distinction suit celle des pièces jointes.
 *
 * **Du JSON** quand la demande ne porte que du texte et des images. Les images ont déjà été
 * envoyées à la bibliothèque du projet ; seuls leurs identifiants circulent ici.
 *
 * **Un formulaire multipart** quand un document est joint. Le document n'est pas un bien du
 * projet mais un contexte d'un instant : il voyage avec la demande et disparaît avec elle.
 * Le stocker pour le relire au message suivant obligerait à une table, à un ménage et à une
 * adresse qui le sert — pour un fichier que personne ne redemandera.
 */
const input = z.object({
  message: z.string().min(1).max(2000),
  /**
   * Images jointes à la demande.
   *
   * Seuls des identifiants transitent : les fichiers ont déjà été envoyés et traités par
   * la bibliothèque du projet. Le service les relit et n'en retient que ceux qui
   * appartiennent bien à ce créateur et à ce projet — le navigateur ne fait que désigner.
   */
  mediaIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS).optional(),
})

/**
 * L'agent enchaîne plusieurs appels au modèle : il lui faut davantage que les quelques
 * dizaines de secondes d'un appel unique. Ses propres bornes l'arrêtent bien avant.
 */
export const maxDuration = 300

type Demande = { message: string; mediaIds: string[]; documents: AttachedDocument[] }

/** Les identifiants d'images d'un champ de formulaire, ou rien. */
function lireIdentifiants(brut: FormDataEntryValue | null): unknown {
  if (typeof brut !== 'string' || brut === '') return undefined
  try {
    return JSON.parse(brut) as unknown
  } catch {
    return undefined
  }
}

/** Lit le corps, quelle que soit sa forme. */
async function lireDemande(request: Request): Promise<Demande> {
  const type = request.headers.get('content-type') ?? ''
  if (!type.includes('multipart/form-data')) {
    const body = input.parse(await readJson(request))
    return { message: body.message, mediaIds: body.mediaIds ?? [], documents: [] }
  }

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > (MAX_DOCUMENT_BYTES + 4096) * MAX_DOCUMENTS) {
    throw validation('Ces documents sont trop lourds. Envoyez la partie qui compte.')
  }

  const form = await request.formData()
  const body = input.parse({
    message: form.get('message'),
    // Le champ arrive en texte : c'est ce qu'un formulaire sait transporter. Un texte
    // illisible vaut « aucune image » ; Zod se charge du reste.
    mediaIds: lireIdentifiants(form.get('mediaIds')),
  })

  const fichiers = form.getAll('document').filter((entry): entry is File => entry instanceof File)
  if (fichiers.length > MAX_DOCUMENTS) {
    throw validation(`Joignez au plus ${MAX_DOCUMENTS} documents à une même demande.`)
  }

  const documents: AttachedDocument[] = []
  for (const fichier of fichiers) {
    documents.push(readDocument(fichier.name, new Uint8Array(await fichier.arrayBuffer())))
  }
  return { message: body.message, mediaIds: body.mediaIds ?? [], documents }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ messages: await listChatMessages(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const demande = await lireDemande(request)

    const agent = await isEnabled('appBuilder')
    return ok(
      agent
        ? await editWithAgent(user.id, id, demande.message, demande.mediaIds, demande.documents)
        : await editWithAssistant(user.id, id, demande.message, demande.mediaIds, demande.documents),
    )
  } catch (error) {
    return fail(error)
  }
}
