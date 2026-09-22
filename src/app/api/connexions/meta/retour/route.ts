import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { logger } from '@/server/observability/logger'
import { lireEtat } from '@/server/integrations/oauth'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import { metaAds } from '@/server/ads/meta-ads'
import { enregistrerComptes } from '@/server/ads/comptes'

/**
 * Retour de l'écran de consentement Meta.
 *
 * Trois vérifications avant d'enregistrer quoi que ce soit, identiques à celles du retour
 * Google parce qu'elles ferment les mêmes portes : l'état doit être signé par Evoliia et non
 * expiré, la personne connectée doit être celle qui est partie, et le fournisseur désigné
 * doit être bien celui-ci — un état émis pour Google Ads ne doit pas enregistrer une
 * connexion Meta, quand bien même il serait parfaitement valide.
 *
 * Rien de ce qui transite ici n'entre dans le journal : ni le code, ni les jetons.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const locale = resolveLocale('fr')
  const versConnexions = (issue: string) => `/${locale}/connexions?meta=${issue}`

  if (!metaAds.estConfigure()) redirect(`/${locale}/connexions`)

  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  /*
   * Meta renvoie `error=access_denied` quand la personne a refusé. Ce n'est pas une panne :
   * c'est une réponse, et elle mérite un écran qui le dit plutôt qu'un message d'échec.
   */
  if (url.searchParams.get('error') !== null) redirect(versConnexions('refuse'))

  const etat = lireEtat(url.searchParams.get('state') ?? '')
  const code = url.searchParams.get('code') ?? ''
  /*
   * L'identifiant du fournisseur est vérifié en plus de la signature. Les deux retours
   * Google partagent une adresse et se distinguent par cet identifiant ; celui-ci a la
   * sienne, et accepter n'importe quel état signé y enregistrerait une connexion Meta à
   * partir d'une autorisation obtenue pour autre chose.
   */
  if (etat === null || etat.userId !== user.id || etat.providerId !== metaAds.id || code === '') {
    logger.warn('retour Meta refusé : état invalide')
    redirect(versConnexions('etat'))
  }

  const provider = findProvider(etat.providerId)
  if (provider === undefined) redirect(versConnexions('etat'))

  const echange = await metaAds.echangerCode(code)
  if (!echange.ok) {
    logger.warn('retour Meta refusé : échange impossible')
    redirect(versConnexions('echec'))
  }

  /*
   * La connexion est enregistrée AVANT la lecture des comptes, comme pour Google Ads et pour
   * la même raison : `ads_management` ouvre l'écriture, donc l'autorisation vient d'être
   * accordée pour de bon chez Meta. Ne pas la conserver parce qu'une lecture a échoué
   * laisserait une autorisation vivante côté Meta sans trace côté Evoliia — ni révocable
   * depuis ici, ni visible.
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

  const comptes = await enregistrerComptes(user.id, echange.jetons.accessToken, metaAds)
  if (!comptes.ok) {
    logger.warn('retour Meta : aucun compte lisible')
    redirect(versConnexions('meta-sans-compte'))
  }

  logger.info('Meta Ads relié', { comptes: comptes.comptes.length })
  redirect(`/${locale}/publicite`)
}
