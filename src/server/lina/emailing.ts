import { withUserScope } from '@/server/db/scope'
import { lireOutil, NOM_OUTIL, OUTILS_EMAILING, type OutilEmailing } from '@/server/integrations/providers/emailing'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { FRAICHEUR_MS, PAUSE_MANUELLE_MS } from '@/server/nova/collecte-commerce'
import { logger } from '@/server/observability/logger'
import { importerCampagnes } from './resultats'

/**
 * La relecture des résultats depuis l'outil d'envoi relié : Klaviyo, Brevo ou Mailchimp.
 *
 * Au rythme du reste de Lina : douze heures entre deux lectures à l'ouverture, deux minutes
 * sur un clic. Un seul outil est lu — le premier relié dans l'ordre ci-dessus ; une boutique
 * n'envoie pas ses campagnes depuis trois outils à la fois. Rien ici ne coûte un crédit.
 */

export type EtatEmailing = { outil: OutilEmailing; nom: string; at: Date | null; message: string } | null

/** `enErreur` : une clé refusée reste un outil relié pour l'écran, qui doit dire pourquoi il ne lit plus. */
async function outilRelie(userId: string, enErreur = false): Promise<{ outil: OutilEmailing; cle: string; connectionId: string } | null> {
  for (const outil of OUTILS_EMAILING) {
    const connexion = await useCredential(userId, outil, { includePending: enErreur }).catch(() => null)
    if (connexion !== null) return { outil, cle: connexion.secret, connectionId: connexion.connectionId }
  }
  return null
}

export async function lireEtatEmailing(userId: string): Promise<EtatEmailing> {
  const relie = await outilRelie(userId, true)
  if (relie === null) return null
  const ligne = await withUserScope(userId, (tx) => tx.linaSynchro.findUnique({ where: { userId }, select: { emailingAt: true, emailingMessage: true } }))
  return { outil: relie.outil, nom: NOM_OUTIL[relie.outil], at: ligne?.emailingAt ?? null, message: ligne?.emailingMessage ?? '' }
}

async function noter(userId: string, data: { emailingAt?: Date; emailingMessage: string }): Promise<void> {
  await withUserScope(userId, (tx) => tx.linaSynchro.upsert({ where: { userId }, create: { userId, ...data }, update: data }))
}

export async function synchroniserEmailing(userId: string, mode: 'auto' | 'manuel', maintenant = new Date()): Promise<EtatEmailing> {
  const relie = await outilRelie(userId)
  if (relie === null) return null
  const ligne = await withUserScope(userId, (tx) => tx.linaSynchro.findUnique({ where: { userId }, select: { emailingAt: true } }))
  const derniere = ligne?.emailingAt ?? null
  const attente = mode === 'auto' ? FRAICHEUR_MS : PAUSE_MANUELLE_MS
  if (derniere !== null && +maintenant - +derniere < attente) return lireEtatEmailing(userId)
  try {
    const lecture = await lireOutil(relie.outil, relie.cle)
    if (!lecture.ok) {
      await markConnectionError(userId, relie.connectionId, lecture.raison)
      await noter(userId, { emailingAt: maintenant, emailingMessage: lecture.raison.slice(0, 300) })
      return lireEtatEmailing(userId)
    }
    await importerCampagnes(userId, relie.outil, lecture.campagnes)
    await noter(userId, { emailingAt: maintenant, emailingMessage: '' })
    logger.info('résultats relus pour Lina', { outil: relie.outil, campagnes: lecture.campagnes.length })
  } catch (error) {
    const raison = error instanceof Error ? error.message : `${NOM_OUTIL[relie.outil]} n’a pas répondu.`
    await noter(userId, { emailingAt: maintenant, emailingMessage: raison.slice(0, 300) }).catch(() => undefined)
    logger.warn('lecture de l’outil d’emailing en échec', { userId })
  }
  return lireEtatEmailing(userId)
}
