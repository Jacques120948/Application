import { env } from '@/lib/env'
import { logger } from '@/server/observability/logger'

/**
 * Envoi d'e-mails transactionnels.
 *
 * Aucune bibliothèque : un appel HTTP suffit, et une dépendance de moins est une surface
 * d'attaque de moins. Le fournisseur est Resend, choisi parce qu'il s'installe avec une
 * seule clé et fonctionne sans serveur de courrier à administrer.
 *
 * Principe important : tant qu'aucune clé n'est configurée, la plateforme le dit au lieu
 * de faire semblant. Un formulaire « mot de passe oublié » qui affiche « message envoyé »
 * sans rien envoyer est pire que pas de formulaire du tout.
 */

export type Email = {
  to: string
  subject: string
  /** Corps en texte simple. Pas de HTML : rien à échapper, rien à casser. */
  text: string
}

export function isEmailAvailable(): boolean {
  return env.resendApiKey !== undefined && env.emailFrom !== undefined
}

export async function sendEmail(email: Email): Promise<void> {
  const apiKey = env.resendApiKey
  const from = env.emailFrom
  if (apiKey === undefined || from === undefined) {
    logger.warn('envoi e-mail impossible : aucun fournisseur configuré')
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
    }),
  })

  if (!response.ok) {
    // Le détail reste dans les journaux : il peut contenir l'adresse du destinataire.
    logger.error('envoi e-mail refusé par le fournisseur', { status: response.status })
    throw new Error('email_refuse')
  }
}
