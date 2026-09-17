import { createHmac, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { env } from '@/lib/env'
import { unauthenticated } from '@/lib/errors'

/**
 * Sessions du studio.
 *
 * Le jeton en clair n'existe que dans le cookie du navigateur. La base ne stocke qu'une
 * empreinte HMAC-SHA256 : une copie de la table ne permet pas de forger une session.
 */

export const SESSION_COOKIE = 'af_session'

/** Durée de vie absolue d'une session, quelle que soit l'activité. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** En dessous de ce seuil restant, la session est prolongée à l'usage. */
const SESSION_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Inactivité tolérée avant déconnexion.
 *
 * L'échéance absolue ne protège de rien au quotidien : une session ouverte sur un poste
 * partagé et oubliée y restait ouverte des semaines. Vingt minutes sans le moindre signe de
 * vie, et le serveur révoque — quel que soit ce que dit le cookie.
 */
export const IDLE_TIMEOUT_MS = 20 * 60_000

/**
 * Pas plus d'une écriture de fraîcheur par minute et par session.
 *
 * Sans ce palier, chaque page vue écrirait en base, y compris les images et les appels
 * d'arrière-plan : beaucoup d'écritures pour une précision dont personne n'a l'usage. La
 * minute est très en dessous des vingt minutes mesurées, donc elle ne fausse rien.
 */
const TOUCH_INTERVAL_MS = 60_000

export type AuthenticatedUser = {
  id: string
  email: string
  name: string | null
  locale: string
  role: UserRole
}

function hashToken(token: string): string {
  return createHmac('sha256', env.sessionSecret).update(token).digest('hex')
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createSession(
  userId: string,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: context.ip ?? null,
      userAgent: context.userAgent?.slice(0, 255) ?? null,
    },
  })
  return { token, expiresAt }
}

/** Résout la session portée par le cookie, ou `null`. Ne lève jamais. */
/**
 * Lit le cookie de session, s'il y en a un.
 *
 * Hors du traitement d'une requête — dans un script, une tâche planifiée, un test — il n'y
 * a pas de cookie du tout. Next signale ce cas par une exception ; ce n'est pas une erreur
 * ici, simplement l'absence de session.
 */
async function readSessionToken(): Promise<string | undefined> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value
  } catch {
    return undefined
  }
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = await readSessionToken()
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) return null
  if (session.user.disabledAt !== null) return null

  const maintenant = Date.now()

  /*
   * Inactivité : la session est révoquée, pas seulement ignorée.
   *
   * La révoquer ferme la porte pour de bon — un jeton volé après coup ne rouvre rien, et la
   * personne le voit dans la liste de ses sessions. L'ignorer silencieusement laisserait une
   * ligne valide en base, qui redeviendrait utilisable à la moindre erreur de calcul de date.
   */
  if (maintenant - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await prisma.session
      .updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined)
    return null
  }

  const remaining = session.expiresAt.getTime() - maintenant
  const prolonge = remaining < SESSION_REFRESH_THRESHOLD_MS
  const rafraichir = maintenant - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS

  if (prolonge || rafraichir) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: {
          ...(prolonge ? { expiresAt: new Date(maintenant + SESSION_TTL_MS) } : {}),
          ...(rafraichir ? { lastSeenAt: new Date(maintenant) } : {}),
        },
      })
      .catch(() => undefined)
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    locale: session.user.locale,
    role: session.user.role,
  }
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  if (!user) throw unauthenticated()
  return user
}

export async function revokeCurrentSession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * Vérification d'origine pour les requêtes mutantes (défense CSRF complémentaire de
 * SameSite=Lax). Renvoie `false` si l'origine ne correspond pas à l'hôte servi.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === null) return true // navigation directe, pas une requête inter-site
  try {
    const host = request.headers.get('host')
    return host !== null && new URL(origin).host === host
  } catch {
    return false
  }
}
