import { z } from 'zod'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import { createRecord, listRecords } from '@/server/runtime/records'
import { getEndUser } from '@/server/runtime/end-users'
import { consume, RULES } from '@/server/auth/rate-limit'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

/**
 * API de données d'une application générée.
 *
 * Le client n'indique jamais la forme des données : il envoie un identifiant de modèle et
 * des valeurs, le serveur relit la spécification de référence et valide tout.
 */

const createInput = z.object({
  modelId: z.string().min(1).max(48),
  data: z.record(z.string(), z.unknown()),
})

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params
    const runtime = await resolveRuntimeSpec(projectId)
    const modelId = new URL(request.url).searchParams.get('modelId') ?? ''
    const endUser = await getEndUser(runtime.projectId)
    const items = await listRecords({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId,
      endUserId: endUser?.id ?? null,
    })
    return ok({ items })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    consume(`app-write:${projectId}:${clientIp(request) ?? 'inconnu'}`, RULES.appWrite)

    const runtime = await resolveRuntimeSpec(projectId)
    const body = createInput.parse(await readJson(request))
    const endUser = await getEndUser(runtime.projectId)

    const record = await createRecord({
      projectId: runtime.projectId,
      spec: runtime.spec,
      modelId: body.modelId,
      endUserId: endUser?.id ?? null,
      input: body.data,
    })
    return ok({ record }, 201)
  } catch (error) {
    return fail(error)
  }
}
