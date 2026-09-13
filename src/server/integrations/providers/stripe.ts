import type Stripe from 'stripe'
import { env } from '@/lib/env'
import { AppError, notFound, validation } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { findProvider } from '../catalog'
import { assertConnectionSlot, isProviderOpen, storeConnection, useCredential } from '../service'

/**
 * Stripe Connect, comptes standard.
 *
 * Le créateur ouvre (ou relie) son propre compte Stripe, avec son propre tableau de bord
 * Stripe, ses propres virements, ses propres obligations. Evoliia n'est que la plateforme
 * qui crée les pages de paiement en son nom : l'argent ne passe jamais par le compte
 * d'Evoliia, et les frais Stripe sont facturés au créateur.
 *
 * Ce qu'Evoliia conserve : l'identifiant du compte connecté, chiffré comme n'importe quel
 * secret de créateur. Rien d'autre — ni jeton, ni clé, ni coordonnées bancaires.
 */

const PROVIDER_ID = 'stripe'
const PENDING = 'Inscription Stripe à terminer. Cliquez sur « Connecter » pour reprendre.'

function provider() {
  const found = findProvider(PROVIDER_ID)
  if (found === undefined) throw notFound("Stripe n'est pas dans le catalogue.")
  return found
}

function returnUrls(locale: string): { refresh: string; ret: string } {
  const base = `${env.appUrl.replace(/\/$/, '')}/api/connexions/stripe/retour?locale=${encodeURIComponent(locale)}`
  return { refresh: `${base}&etat=reprendre`, ret: base }
}

/**
 * Commence, ou reprend, l'inscription Stripe du créateur. Renvoie l'adresse de la page
 * d'inscription Stripe, valable quelques minutes.
 */
export async function startStripeOnboarding(stripe: Stripe, userId: string, locale: string): Promise<string> {
  const stripeProvider = provider()
  if (!(await isProviderOpen(stripeProvider))) {
    throw validation("Le paiement en ligne n'est pas activé sur cette installation.")
  }
  await assertConnectionSlot(userId, PROVIDER_ID)

  // Une inscription commencée est reprise, jamais recommencée : un créateur qui a fermé
  // l'onglet à mi-chemin retrouve son compte, pas un deuxième.
  const existing = await useCredential(userId, PROVIDER_ID, { target: 'APP', includePending: true })
  let accountId = existing?.secret ?? null

  if (accountId === null) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (user === null) throw notFound("Ce compte n'existe pas.")
    const account = await stripe.accounts.create({
      type: 'standard',
      email: user.email,
      metadata: { userId },
    })
    accountId = account.id
    await storeConnection(userId, stripeProvider, {
      kind: 'OAUTH',
      secret: accountId,
      accountLabel: null,
      status: 'ERROR',
      lastError: PENDING,
    })
    logger.info('stripe connect : compte créé', { userId })
  }

  const { refresh, ret } = returnUrls(locale)
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refresh,
    return_url: ret,
    type: 'account_onboarding',
  })
  return link.url
}

/**
 * Au retour de Stripe : le compte est relu, jamais cru. Une inscription incomplète reste
 * marquée comme telle, avec un bouton pour la reprendre.
 */
export async function completeStripeOnboarding(
  stripe: Stripe,
  userId: string,
): Promise<'connecte' | 'incomplet'> {
  const stripeProvider = provider()
  const existing = await useCredential(userId, PROVIDER_ID, { target: 'APP', includePending: true })
  if (existing === null) throw new AppError('NOT_FOUND', "Aucune inscription Stripe n'est en cours.")

  const account = await stripe.accounts.retrieve(existing.secret)
  const ready = account.charges_enabled === true
  await storeConnection(userId, stripeProvider, {
    kind: 'OAUTH',
    secret: account.id,
    accountLabel: ready ? (account.business_profile?.name ?? account.email ?? 'Compte Stripe') : null,
    status: ready ? 'CONNECTED' : 'ERROR',
    lastError: ready ? null : PENDING,
  })
  logger.info('stripe connect : retour', { userId, ready })
  return ready ? 'connecte' : 'incomplet'
}
