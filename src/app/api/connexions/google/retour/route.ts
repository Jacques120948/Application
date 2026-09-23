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
import { googleAds } from '@/server/ads/google-ads'
import { listerProprietes as listerProprietesGa4 } from '@/server/integrations/providers/google-analytics'
import { enregistrerComptes } from '@/server/ads/comptes'

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

  /*
   * Une seule adresse de retour pour deux connexions Google, et c'est voulu : chaque
   * adresse déclarée chez Google doit l'être à la main, et une de plus est une occasion de
   * plus de se tromper le jour d'un déploiement. C'est l'état signé qui dit laquelle des
   * deux revient — il porte déjà l'identifiant du fournisseur, et il est signé, donc ce
   * n'est pas le navigateur qui en décide.
   */
  if (!estConfigure() && !googleAds.estConfigure()) redirect(`/${locale}/connexions`)

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

  /*
   * L'échange passe par le fournisseur qui a lancé l'autorisation. Les deux emploient le
   * même point d'échange chez Google, mais pas la même adresse de retour déclarée ni les
   * mêmes portées : mélanger les deux produirait un refus que rien n'expliquerait.
   */
  const versAds = etat.providerId === googleAds.id
  const echange = versAds ? await googleAds.echangerCode(code) : await echangerCode(code)
  if (!echange.ok) {
    logger.warn('retour Google refusé : échange impossible')
    redirect(versConnexions('echec'))
  }

  if (versAds) {
    /*
     * La connexion est enregistrée AVANT la lecture des comptes, contrairement à Search
     * Console. La raison est la portée : `adwords` ouvre l'écriture, donc l'autorisation
     * vient d'être accordée pour de bon chez Google. Ne pas la conserver parce qu'une
     * lecture a échoué laisserait une autorisation vivante côté Google sans trace côté
     * Evoliia — ni révocable depuis ici, ni visible.
     */
    await storeConnection(user.id, provider, {
      kind: 'OAUTH',
      secret: echange.jetons.accessToken,
      ...(echange.jetons.refreshToken === undefined
        ? {}
        : { refreshSecret: echange.jetons.refreshToken }),
      accountLabel: null,
      expiresAt: echange.jetons.expiresAt,
    })

    const comptes = await enregistrerComptes(user.id, echange.jetons.accessToken)
    if (!comptes.ok) {
      logger.warn('retour Google Ads : aucun compte lisible')
      redirect(versConnexions('ads-sans-compte'))
    }

    logger.info('Google Ads relié', { comptes: comptes.comptes.length })
    redirect(`/${locale}/publicite`)
  }

  /*
   * Google Analytics : même contrôle que Search Console — au moins une propriété lisible, ou
   * rien n'est enregistré. Une connexion verte qui ne donne accès à aucune propriété se
   * découvrirait sur l'écran de Nova, vide et sans explication.
   */
  if (etat.providerId === 'google-analytics') {
    const ga4 = await listerProprietesGa4(echange.jetons.accessToken)
    if (!ga4.ok || ga4.proprietes.length === 0) {
      logger.warn('retour Google Analytics refusé : aucune propriété lisible')
      redirect(versConnexions('ga4-sans-propriete'))
    }
    await storeConnection(user.id, provider, {
      kind: 'OAUTH',
      secret: echange.jetons.accessToken,
      ...(echange.jetons.refreshToken === undefined ? {} : { refreshSecret: echange.jetons.refreshToken }),
      accountLabel: ga4.proprietes.map((propriete) => propriete.nom).join(', ').slice(0, 200),
      expiresAt: echange.jetons.expiresAt,
    })
    logger.info('Google Analytics relié', { proprietes: ga4.proprietes.length })
    redirect(`/${locale}/nova`)
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
