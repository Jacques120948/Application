import { z } from 'zod'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import { deleteRecord, updateRecord } from '@/server/runtime/records'
import { getEndUser } from '@/server/runtime/end-users'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

/**
 * Un enregistrement d'une application générée : le corriger ou le supprimer.
 *
 * Les deux gestes obéissent à la même règle, vérifiée côté serveur : celui qui a saisi une
 * donnée en dispose, personne d'autre. Et comme à la création, la saisie envoyée est
 * revalidée en entier contre le modèle publié — le navigateur ne décide jamais de la forme
 * des données.
 */

const deleteInput = z.object({ modelId: z.string().min(1).max(48) })

const updateInput = z.object({
  modelId: z.string().min(1).max(48),
  data: z.record(z.string(), z.unknown()),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; recordId: string }> },
) {
  try {
    assertSameOrigin(request)
    const { projectId, recordId } = await context.params
    consume(`app-write:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.appWrite)

    const runtime = await resolveRuntimeSpec(projectId)
    const body = updateInput.parse(await readJson(request))
    const endUser = await getEndUser(runtime.projectId)

    const record = await updateRecord({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId: body.modelId,
      recordId,
      endUserId: endUser?.id ?? null,
      input: body.data,
    })
    return ok({ record })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string; recordId: string }> },
) {
  try {
    assertSameOrigin(request)
    const { projectId, recordId } = await context.params
    // Une suppression est une écriture comme une autre : elle compte dans le même quota
    // que la création, sans quoi une boucle pourrait vider une application sans frein.
    consume(`app-write:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.appWrite)

    const runtime = await resolveRuntimeSpec(projectId)
    const body = deleteInput.parse(await readJson(request))
    const endUser = await getEndUser(runtime.projectId)

    await deleteRecord({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId: body.modelId,
      recordId,
      endUserId: endUser?.id ?? null,
    })
    return ok({ done: true })
  } catch (error) {
    return fail(error)
  }
}
