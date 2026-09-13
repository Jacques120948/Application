import { z } from 'zod'
import { requireUser } from '@/server/auth/session'
import { SUPPORTED_LOCALES } from '@/i18n/config'
import {
  createEntry,
  deleteEntry,
  entryInput,
  entryUpdate,
  generateEntries,
  listEntries,
  updateEntry,
} from '@/server/support/knowledge'
import { assertSameOrigin, fail, ok, readJson } from '@/server/http/respond'

type Context = { params: Promise<{ id: string }> }

export const maxDuration = 90

const postInput = z.discriminatedUnion('action', [
  entryInput.extend({ action: z.literal('create') }),
  z.object({ action: z.literal('generate'), locale: z.enum(SUPPORTED_LOCALES).default('fr') }),
])

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser()
    const { id } = await context.params
    return ok({ entries: await listEntries(user.id, id) })
  } catch (error) {
    return fail(error)
  }
}

/** Créer une entrée à la main, ou en proposer plusieurs depuis le contenu (payant). */
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = postInput.parse(await readJson(request))
    if (body.action === 'generate') return ok(await generateEntries(user.id, id, body.locale))
    const { action: _action, ...input } = body
    return ok({ entry: await createEntry(user.id, id, input) })
  } catch (error) {
    return fail(error)
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const input = entryUpdate.parse(await readJson(request))
    return ok({ entry: await updateEntry(user.id, id, input) })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request)
    const user = await requireUser()
    const { id } = await context.params
    const body = z.object({ id: z.string().uuid() }).parse(await readJson(request))
    await deleteEntry(user.id, id, body.id)
    return ok({ deleted: true })
  } catch (error) {
    return fail(error)
  }
}
