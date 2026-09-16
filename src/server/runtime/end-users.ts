import { createHmac, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { validation } from '@/lib/errors'
import { env } from '@/lib/env'
import { withRuntimeScope } from '@/server/db/scope'
import { assertPasswordAcceptable, hashPassword, verifyPassword } from '@/server/auth/password'
import { consume, RULES } from '@/server/auth/rate-limit'
import { isEmailAvailable, sendEmail } from '@/server/email/send'
import { logger } from '@/server/observability/logger'

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

// ─────────────────── Mot de passe oublié, côté visiteur ──────────────────────

/**
 * Réinitialisation du mot de passe d'un visiteur d'application.
 *
 * Sans elle, un visiteur qui oublie son mot de passe est bloqué définitivement : son
 * compte n'existe que dans l'application d'un créateur, et personne n'a de moyen de le lui
 * rendre. Les trois règles du parcours d'Evoliia valent ici mot pour mot.
 *
 *   1. **La demande répond toujours la même chose.** Qu'un compte existe ou non, le message
 *      est identique : sinon ce formulaire dirait qui est inscrit dans l'application.
 *   2. **Le jeton n'est jamais stocké en clair.** La base ne garde qu'une empreinte, salée
 *      par le projet comme les jetons de session : une empreinte d'une application ne peut
 *      pas être rejouée sur une autre.
 *   3. **Changer le mot de passe déconnecte partout.** Quelqu'un qui réinitialise parce
 *      qu'il soupçonne une intrusion doit réellement en chasser l'intrus.
 */

const RESET_TTL_MS = 60 * 60 * 1000

/**
 * Demande un lien. Ne dit jamais si le compte existe, et n'échoue pas si l'envoi échoue :
 * l'appelant affiche le même message dans tous les cas.
 */
export async function requestEndUserReset(params: {
  projectId: string
  appName: string
  appUrl: string
  email: string
  ip?: string | null
}): Promise<void> {
  const email = params.email.trim().toLowerCase()
  consume(`reset-app:ip:${params.ip ?? 'inconnu'}`, RULES.passwordReset)
  consume(`reset-app:${params.projectId}:${email}`, RULES.passwordReset)

  const token = randomBytes(32).toString('base64url')
  const envoyer = await withRuntimeScope(params.projectId, async (tx) => {
    const endUser = await tx.appEndUser.findFirst({
      where: { projectId: params.projectId, email },
      select: { id: true },
    })
    if (endUser === null) return false

    // Une nouvelle demande annule les précédentes : un seul lien vivant à la fois.
    await tx.appEndUserToken.updateMany({
      where: { endUserId: endUser.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    await tx.appEndUserToken.create({
      data: {
        projectId: params.projectId,
        endUserId: endUser.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    })
    return true
  })

  if (!envoyer) {
    logger.info('réinitialisation visiteur sans compte correspondant', { projectId: params.projectId })
    return
  }
  if (!isEmailAvailable()) {
    logger.warn('réinitialisation visiteur impossible : aucun fournisseur de courriel')
    return
  }

  const lien = `${params.appUrl}?jeton=${token}`
  try {
    await sendEmail({
      to: email,
      // Le message parle de l'application du créateur, pas d'Evoliia : c'est là que le
      // compte existe, et c'est le nom que la personne reconnaîtra.
      subject: `Réinitialiser votre mot de passe sur ${params.appName}`,
      text: [
        `Vous avez demandé à changer votre mot de passe sur ${params.appName}.`,
        '',
        'Ouvrez ce lien pour en choisir un nouveau :',
        lien,
        '',
        "Ce lien est valable une heure et ne fonctionne qu'une fois.",
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.",
        '',
        `${params.appName} est une application créée avec Evoliia.`,
      ].join('\n'),
    })
    logger.info('lien de réinitialisation visiteur envoyé', { projectId: params.projectId })
  } catch {
    // L'échec d'envoi ne doit pas révéler que le compte existe.
    logger.error('envoi du lien de réinitialisation visiteur impossible', {
      projectId: params.projectId,
    })
  }
}

/** Pose le nouveau mot de passe, consomme le jeton et ferme toutes les sessions ouvertes. */
export async function confirmEndUserReset(params: {
  projectId: string
  token: string
  password: string
  ip?: string | null
}): Promise<void> {
  consume(`reset-app-confirm:ip:${params.ip ?? 'inconnu'}`, RULES.passwordReset)
  assertPasswordAcceptable(params.password)
  const passwordHash = await hashPassword(params.password)

  await withRuntimeScope(params.projectId, async (tx) => {
    const jeton = await tx.appEndUserToken.findFirst({
      where: { tokenHash: hashToken(params.token), projectId: params.projectId },
      select: { id: true, endUserId: true, consumedAt: true, expiresAt: true },
    })
    if (jeton === null || jeton.consumedAt !== null || jeton.expiresAt.getTime() < Date.now()) {
      throw validation(
        "Ce lien n'est plus valable. Demandez-en un nouveau depuis la page de connexion.",
      )
    }
    await tx.appEndUserToken.update({ where: { id: jeton.id }, data: { consumedAt: new Date() } })
    await tx.appEndUser.update({ where: { id: jeton.endUserId }, data: { passwordHash } })
    await tx.appEndUserSession.updateMany({
      where: { endUserId: jeton.endUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })

  // Le cookie de cette application est vidé par l'appelant : la session courante fait
  // partie de celles qu'on vient de fermer, et seule la couche HTTP touche aux cookies.
  logger.info('mot de passe visiteur réinitialisé', { projectId: params.projectId })
}
