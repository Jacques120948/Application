import { z } from 'zod'
import { validation } from '@/lib/errors'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import { getEndUser, loginEndUser, logoutEndUser, registerEndUser } from '@/server/runtime/end-users'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'

const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('signup'),
    email: z.string().max(200),
    password: z.string().max(200),
    displayName: z.string().max(80).optional(),
  }),
  z.object({ action: z.literal('login'), email: z.string().max(200), password: z.string().max(200) }),
  z.object({ action: z.literal('logout') }),
])

/** Comptes des utilisateurs finaux, strictement cloisonnés par application. */
export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request)
    const { projectId } = await context.params
    const runtime = await resolveRuntimeSpec(projectId)
    const body = input.parse(await readJson(request))

    if (body.action === 'logout') {
      await logoutEndUser(runtime.projectId)
      return ok({ user: null })
    }

    if (!runtime.spec.auth.enabled) {
      throw validation("Cette application n'utilise pas de comptes.")
    }
    if (body.action === 'signup' && !runtime.spec.auth.allowSignup) {
      throw validation("Cette application n'accepte pas de nouvelles inscriptions.")
    }

    const user =
      body.action === 'signup'
        ? await registerEndUser({
            projectId: runtime.projectId,
            email: body.email,
            password: body.password,
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
            ip: clientIp(request),
          })
        : await loginEndUser({
            projectId: runtime.projectId,
            email: body.email,
            password: body.password,
            ip: clientIp(request),
          })

    return ok({ user: { email: user.email } })
  } catch (error) {
    return fail(error)
  }
}

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params
    const runtime = await resolveRuntimeSpec(projectId)
    const user = await getEndUser(runtime.projectId)
    return ok({ user: user === null ? null : { email: user.email } })
  } catch (error) {
    return fail(error)
  }
}
