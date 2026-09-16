import { z } from 'zod'
import { publicAppUrl } from '@/lib/apps-domain'
import { validation } from '@/lib/errors'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import {
  confirmEndUserReset,
  getEndUser,
  loginEndUser,
  logoutEndUser,
  registerEndUser,
  requestEndUserReset,
} from '@/server/runtime/end-users'
import { HOME_PATH } from '@/server/spec/validate'
import { assertSameOrigin, clientIp, fail, ok, readJson } from '@/server/http/respond'
import type { AppSpec } from '@/server/spec/schema'

const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('signup'),
    email: z.string().max(200),
    password: z.string().max(200),
    displayName: z.string().max(80).optional(),
  }),
  z.object({ action: z.literal('login'), email: z.string().max(200), password: z.string().max(200) }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('reset'), email: z.string().max(200) }),
  z.object({
    action: z.literal('reset-confirm'),
    token: z.string().min(10).max(200),
    password: z.string().max(200),
  }),
])

/**
 * L'adresse où le lien de réinitialisation doit atterrir.
 *
 * Elle est calculée au serveur, à partir du nom court et de la spécification publiée :
 * jamais à partir d'un en-tête ou d'un champ du navigateur. Un lien envoyé par courriel
 * qui suivrait l'hôte annoncé par l'appelant offrirait à n'importe qui un lien à l'en-tête
 * d'Evoliia pointant vers son propre site.
 *
 * On vise la page qui porte le bloc de connexion ; à défaut, la première page réservée aux
 * personnes connectées, qui affiche le même formulaire ; à défaut, l'accueil.
 */
function resetLanding(spec: AppSpec, slug: string): string {
  const page =
    spec.pages.find((candidate) => candidate.blocks.some((block) => block.type === 'auth')) ??
    spec.pages.find((candidate) => candidate.requiresAuth)
  return `${publicAppUrl(slug)}/${page?.path ?? HOME_PATH}`
}

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

    if (body.action === 'reset') {
      await requestEndUserReset({
        projectId: runtime.projectId,
        appName: runtime.spec.name,
        appUrl: resetLanding(runtime.spec, runtime.slug),
        email: body.email,
        ip: clientIp(request),
      })
      // Réponse volontairement identique, compte existant ou non.
      return ok({ sent: true })
    }

    if (body.action === 'reset-confirm') {
      await confirmEndUserReset({
        projectId: runtime.projectId,
        token: body.token,
        password: body.password,
        ip: clientIp(request),
      })
      // Toutes les sessions viennent d'être fermées, dont celle de ce navigateur : son
      // cookie n'a plus rien à désigner.
      await logoutEndUser(runtime.projectId)
      return ok({ reset: true })
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
