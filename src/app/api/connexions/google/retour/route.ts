import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { logger } from '@/server/observability/logger'
import { lireEtat } from '@/server/integrations/oauth'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import {
  echangerCode,
  estConfigure,
  listerProprietes,
} from '@/server/integrations/providers/google-search-console'

/**
 * Retour de l'écran de consentement Google.
 *
 * Trois vérifications avant d'enregistrer quoi que ce soit, et elles ferment trois portes
 * différentes.
 *
 * **L'état doit être valide.** Signé par Evoliia, non expiré. Sans lui, un code obtenu
 * ailleurs et rejoué ici relierait un compte Google à la session de quelqu'un d'autre.
 *
 * **La personne connectée doit être celle qui est partie.** L'état porte son identifiant :
 * un lien de retour ouvert dans un autre navigateur, ou transmis, ne relie rien.
 *
 * **Le compte doit avoir au moins une propriété.** Une connexion verte qui ne donne accès à
 * rien est pire qu'un refus : elle se découvre au premier écran vide, sans explication.
 *
 * Rien de ce qui transite ici n'entre dans le journal — ni le code, ni les jetons.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const locale = resolveLocale('fr')
  const versConnexions = (issue: string) => `/${locale}/connexions?google=${issue}`

  if (!estConfigure()) redirect(`/${locale}/connexions`)

  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  // Google renvoie `error=access_denied` quand la personne a refusé. Ce n'est pas une panne.
  if (url.searchParams.get('error') !== null) redirect(versConnexions('refuse'))

  const etat = lireEtat(url.searchParams.get('state') ?? '')
  const code = url.searchParams.get('code') ?? ''
  if (etat === null || etat.userId !== user.id || code === '') {
    logger.warn('retour Google refusé : état invalide')
    redirect(versConnexions('etat'))
  }

  const provider = findProvider(etat.providerId)
  if (provider === undefined) redirect(versConnexions('etat'))

  const echange = await echangerCode(code)
  if (!echange.ok) {
    logger.warn('retour Google refusé : échange impossible')
    redirect(versConnexions('echec'))
  }

  const proprietes = await listerProprietes(echange.jetons.accessToken)
  if (!proprietes.ok || proprietes.proprietes.length === 0) {
    logger.warn('retour Google refusé : aucune propriété lisible')
    redirect(versConnexions('sans-propriete'))
  }

  await storeConnection(user.id, provider, {
    kind: 'OAUTH',
    secret: echange.jetons.accessToken,
    ...(echange.jetons.refreshToken === undefined
      ? {}
      : { refreshSecret: echange.jetons.refreshToken }),
    accountLabel: proprietes.proprietes.map((propriete) => propriete.siteUrl).join(', ').slice(0, 200),
    expiresAt: echange.jetons.expiresAt,
  })

  logger.info('Search Console relié', { proprietes: proprietes.proprietes.length })
  redirect(versConnexions('ok'))
}
