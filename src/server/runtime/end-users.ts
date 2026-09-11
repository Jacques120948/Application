import { createHmac, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { validation } from '@/lib/errors'
import { env } from '@/lib/env'
import { withRuntimeScope } from '@/server/db/scope'
import { assertPasswordAcceptable, hashPassword, verifyPassword } from '@/server/auth/password'
import { consume, RULES } from '@/server/auth/rate-limit'

/**
 * Comptes des utilisateurs finaux des applications créées.
 *
 * Cloisonnement (exigence 18) : un cookie **par application**, nommé d'après le projet.
 * Son empreinte en base est salée par le même identifiant, donc un jeton volé sur
 * l'application A est inutilisable sur l'application B. Ce module et le module de session
 * du studio n'ont aucune fonction commune : il n'existe aucun moyen d'échanger l'une
 * contre l'autre, et le studio ne lit jamais ces cookies.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type EndUser = { id: string; email: string; displayName: string | null }

export function cookieName(projectId: string): string {
  return `afu_${projectId.replace(/-/g, '')}`
}

function hashToken(token: string): string {
  // Le sel de domaine lie l'empreinte au projet : une empreinte d'un projet ne peut pas
  // être rejouée sur un autre, même en cas de fuite de la table.
  return createHmac('sha256', env.sessionSecret).update(`app-end-user:${token}`).digest('hex')
}

export async function registerEndUser(params: {
  projectId: string
  email: string
  password: string
  displayName?: string
  ip?: string | null
}): Promise<EndUser> {
  consume(`app-signup:${params.projectId}:${params.ip ?? 'inconnu'}`, RULES.register)
  const email = params.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validation("Cette adresse e-mail n'est pas valide.")
  }
  assertPasswordAcceptable(params.password)

  const passwordHash = await hashPassword(params.password)

  const user = await withRuntimeScope(params.projectId, async (tx) => {
    const existing = await tx.appEndUser.findFirst({
      where: { projectId: params.projectId, email },
      select: { id: true },
    })
    if (existing) throw validation('Un compte existe déjà avec cette adresse e-mail.')
    return tx.appEndUser.create({
      data: {
        projectId: params.projectId,
        email,
        passwordHash,
        displayName: params.displayName?.slice(0, 80) ?? null,
      },
      select: { id: true, email: true, displayName: true },
    })
  })

  await openSession(params.projectId, user.id)
  return user
}

export async function loginEndUser(params: {
  projectId: string
  email: string
  password: string
  ip?: string | null
}): Promise<EndUser> {
  consume(`app-login:${params.projectId}:${params.ip ?? 'inconnu'}`, RULES.login)
  const email = params.email.trim().toLowerCase()

  const user = await withRuntimeScope(params.projectId, (tx) =>
    tx.appEndUser.findFirst({ where: { projectId: params.projectId, email } }),
  )

  const ok = user !== null && (await verifyPassword(params.password, user.passwordHash))
  if (!user || !ok) throw validation('Adresse e-mail ou mot de passe incorrect.')

  await openSession(params.projectId, user.id)
  return { id: user.id, email: user.email, displayName: user.displayName }
}

async function openSession(projectId: string, endUserId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await withRuntimeScope(projectId, (tx) =>
    tx.appEndUserSession.create({
      data: { endUserId, projectId, tokenHash: hashToken(token), expiresAt },
    }),
  )

  const store = await cookies()
  store.set(cookieName(projectId), token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function getEndUser(projectId: string): Promise<EndUser | null> {
  const store = await cookies()
  const token = store.get(cookieName(projectId))?.value
  if (!token) return null

  return withRuntimeScope(projectId, async (tx) => {
    const session = await tx.appEndUserSession.findFirst({
      where: { tokenHash: hashToken(token), projectId, revokedAt: null },
      include: { endUser: true },
    })
    if (!session || session.expiresAt <= new Date()) return null
    return {
      id: session.endUser.id,
      email: session.endUser.email,
      displayName: session.endUser.displayName,
    }
  })
}

export async function logoutEndUser(projectId: string): Promise<void> {
  const store = await cookies()
  const token = store.get(cookieName(projectId))?.value
  if (token) {
    await withRuntimeScope(projectId, (tx) =>
      tx.appEndUserSession.updateMany({
        where: { tokenHash: hashToken(token), projectId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    )
  }
  store.set(cookieName(projectId), '', { path: '/', maxAge: 0 })
}
