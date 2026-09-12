import { requireUser } from '@/server/auth/session'
import {
  approveInput,
  approveKit,
  createLaunchKit,
  updateKit,
  updateKitInput,
} from '@/server/marketing/launch-kit'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

/** Produit le kit de lancement. Consomme des crédits : une seule demande à la fois. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    return ok({ kit: await createLaunchKit(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

/** Enregistre les corrections du créateur. Aucun appel au moteur, aucun crédit. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const input = updateKitInput.parse(await readJson(request))
    return ok({ kit: await updateKit(user.id, input) })
  } catch (error) {
    return fail(error)
  }
}

/** « J'ai relu, cela me convient. » Ne publie rien. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { kitId } = approveInput.parse(await readJson(request))
    await approveKit(user.id, kitId)
    return ok({ approved: true })
  } catch (error) {
    return fail(error)
  }
}
