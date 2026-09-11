import { createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { env } from '@/lib/env'
import { validation } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import { consume, RULES } from './rate-limit'
import { assertPasswordAcceptable, hashPassword } from './password'
import { isEmailAvailable, sendEmail } from '@/server/email/send'

/**
 * Réinitialisation du mot de passe.
 *
 * Trois règles tiennent la sécurité de ce parcours :
 *
 *   1. La demande répond toujours la même chose. Qu'un compte existe ou non, le message
 *      est identique : sinon ce formulaire deviendrait un outil pour découvrir qui est
 *      inscrit.
 *   2. Le jeton n'est jamais stocké en clair. La base ne garde qu'une empreinte HMAC, au
 *      même titre que les jetons de session. Une copie de la table ne permet pas de
 *      prendre un compte.
 *   3. Changer le mot de passe déconnecte partout. Quelqu'un qui réinitialise parce qu'il
 *      soupçonne une intrusion doit réellement en chasser l'intrus.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000

export const resetRequestInput = z.object({
  email: z.string().trim().toLowerCase().email("Cette adresse e-mail n'est pas valide."),
})

export const resetConfirmInput = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string(),
})

function hashToken(token: string): string {
  return createHmac('sha256', env.sessionSecret).update(token).digest('hex')
}

/**
 * Envoie un lien de réinitialisation si le compte existe.
 *
 * Ne renvoie jamais d'information sur l'existence du compte, et n'échoue pas non plus si
 * l'envoi échoue : l'appelant affiche le même message dans tous les cas.
 */
export async function requestPasswordReset(
  email: string,
  context: { ip?: string | null } = {},
): Promise<void> {
  consume(`reset:ip:${context.ip ?? 'inconnu'}`, RULES.passwordReset)
  consume(`reset:compte:${email}`, RULES.passwordReset)

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, disabledAt: true },
  })
  if (user === null || user.disabledAt !== null) {
    logger.info('demande de réinitialisation sans compte correspondant')
    return
  }

  const token = randomBytes(32).toString('base64url')

  await prisma.$transaction(async (tx) => {
    // Une nouvelle demande annule les précédentes : un seul lien vivant à la fois.
    await tx.verificationToken.updateMany({
      where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: new Date() },
    })
    await tx.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    })
  })

  const link = `${env.appUrl.replace(/\/$/, '')}/fr/mot-de-passe/nouveau?jeton=${token}`
  try {
    await sendEmail({
      to: email,
      subject: 'Réinitialiser votre mot de passe Evoliia',
      text: [
        'Vous avez demandé à changer votre mot de passe Evoliia.',
        '',
        'Ouvrez ce lien pour en choisir un nouveau :',
        link,
        '',
        "Ce lien est valable une heure et ne fonctionne qu'une fois.",
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.",
      ].join('\n'),
    })
    logger.info('lien de réinitialisation envoyé', { userId: user.id })
  } catch {
    // L'échec d'envoi ne doit pas révéler que le compte existe.
    logger.error('envoi du lien de réinitialisation impossible', { userId: user.id })
  }
}

/** Pose le nouveau mot de passe et met fin à toutes les sessions ouvertes. */
export async function confirmPasswordReset(
  token: string,
  password: string,
  context: { ip?: string | null } = {},
): Promise<void> {
  consume(`reset-confirm:ip:${context.ip ?? 'inconnu'}`, RULES.passwordReset)
  assertPasswordAcceptable(password)

  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, consumedAt: true, expiresAt: true },
  })

  if (
    record === null ||
    record.purpose !== 'PASSWORD_RESET' ||
    record.consumedAt !== null ||
    record.expiresAt.getTime() < Date.now()
  ) {
    throw validation(
      "Ce lien n'est plus valable. Demandez-en un nouveau depuis la page de connexion.",
    )
  }

  const passwordHash = await hashPassword(password)
  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    })
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } })
    await tx.session.deleteMany({ where: { userId: record.userId } })
  })

  logger.info('mot de passe réinitialisé', { userId: record.userId })
}

export { isEmailAvailable }
