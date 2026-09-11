import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { env } from '@/lib/env'
import { conflict, validation } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import { assertPasswordAcceptable, hashPassword, verifyPassword } from './password'
import { consume, reset, RULES } from './rate-limit'
import { createSession } from './session'
import { grantInitialCredits } from '@/server/billing/credits'
import { SUPPORTED_LOCALES } from '@/i18n/config'

/** Cas d'usage d'authentification : aucune dépendance à HTTP, donc testables directement. */

export const registerInput = z.object({
  email: z.string().trim().toLowerCase().email("Cette adresse e-mail n'est pas valide."),
  password: z.string(),
  name: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(SUPPORTED_LOCALES).default('fr'),
  /** Exigé uniquement lorsque l'installation définit un code d'accès. */
  invitationCode: z.string().trim().max(120).optional(),
})

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email("Cette adresse e-mail n'est pas valide."),
  password: z.string(),
})

export type RegisterInput = z.infer<typeof registerInput>
export type LoginInput = z.infer<typeof loginInput>

type RequestContext = { ip?: string | null; userAgent?: string | null }

export async function register(
  input: RegisterInput,
  context: RequestContext = {},
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  consume(`register:${context.ip ?? 'inconnu'}`, RULES.register)

  const expected = env.signupCode
  if (expected !== undefined && input.invitationCode !== expected) {
    throw validation("Ce code d'accès n'est pas valide.")
  }

  assertPasswordAcceptable(input.password)

  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) {
    throw conflict('Un compte existe déjà avec cette adresse e-mail.')
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      name: input.name ?? null,
      locale: input.locale,
    },
  })

  await grantInitialCredits(user.id)

  const session = await createSession(user.id, context)
  logger.info('compte créé', { userId: user.id })
  return { userId: user.id, token: session.token, expiresAt: session.expiresAt }
}

export async function login(
  input: LoginInput,
  context: RequestContext = {},
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  const ipKey = `login:ip:${context.ip ?? 'inconnu'}`
  const accountKey = `login:compte:${input.email}`
  consume(ipKey, RULES.login)
  consume(accountKey, RULES.login)

  const user = await prisma.user.findUnique({ where: { email: input.email } })

  // Réponse indifférenciée : un compte inexistant et un mot de passe faux donnent le
  // même message et un temps de traitement comparable.
  const storedHash = user?.passwordHash ?? (await placeholderHash())
  const passwordOk = await verifyPassword(input.password, storedHash)

  if (!user || !passwordOk || user.disabledAt !== null) {
    logger.warn('échec de connexion', { hasAccount: user !== null })
    throw validation('Adresse e-mail ou mot de passe incorrect.')
  }

  reset(ipKey)
  reset(accountKey)

  const session = await createSession(user.id, context)
  return { userId: user.id, token: session.token, expiresAt: session.expiresAt }
}

let placeholder: Promise<string> | null = null
/** Empreinte fictive, calculée une fois, pour égaliser le temps de réponse. */
function placeholderHash(): Promise<string> {
  placeholder ??= hashPassword('mot-de-passe-inexistant-pour-egaliser-le-temps')
  return placeholder
}
