import type Stripe from 'stripe'
import { env } from '@/lib/env'
import { assertEncryptionReady } from '@/lib/crypto'
import { AppError, notFound, validation } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { findProvider } from '../catalog'
import { assertConnectionSlot, isProviderOpen, storeConnection, useCredential } from '../service'

/**
 * Stripe Connect, comptes v2 avec tableau de bord complet (l'équivalent des anciens
 * comptes « standard »).
 *
 * Le créateur ouvre (ou relie) son propre compte Stripe, avec son propre tableau de bord
 * Stripe, ses propres virements, ses propres obligations. Evoliia n'est que la plateforme
 * qui crée les pages de paiement en son nom : l'argent ne passe jamais par le compte
 * d'Evoliia, et les frais Stripe comme les pertes sont à la charge du compte du créateur
 * (`fees_collector` et `losses_collector` à « stripe »), jamais de la plateforme.
 *
 * Ce qu'Evoliia conserve : l'identifiant du compte connecté, chiffré comme n'importe quel
 * secret de créateur. Rien d'autre — ni jeton, ni clé, ni coordonnées bancaires.
 */

const PROVIDER_ID = 'stripe'
const PENDING = 'Inscription Stripe à terminer. Cliquez sur « Reprendre la connexion » pour continuer.'

/**
 * Pays du compte Stripe, à partir de ce que le créateur a déclaré dans son profil. Stripe
 * ne le laisse plus changer ensuite : à défaut d'une correspondance sûre, la Suisse, pays
 * d'Evoliia, et le créateur le verra dès le premier écran de Stripe.
 */
const COUNTRY_CODES: Record<string, string> = {
  suisse: 'ch',
  switzerland: 'ch',
  schweiz: 'ch',
  svizzera: 'ch',
  france: 'fr',
  belgique: 'be',
  belgium: 'be',
  luxembourg: 'lu',
  allemagne: 'de',
  deutschland: 'de',
  germany: 'de',
  italie: 'it',
  italia: 'it',
  italy: 'it',
  espagne: 'es',
  españa: 'es',
  spain: 'es',
  autriche: 'at',
  österreich: 'at',
  austria: 'at',
  'pays-bas': 'nl',
  nederland: 'nl',
  netherlands: 'nl',
  portugal: 'pt',
  canada: 'ca',
  'royaume-uni': 'gb',
  'united kingdom': 'gb',
  'états-unis': 'us',
  'etats-unis': 'us',
  'united states': 'us',
}

export function countryCodeOf(country: string | null | undefined): string {
  const key = (country ?? '').trim().toLowerCase()
  if (/^[a-z]{2}$/.test(key)) return key
  return COUNTRY_CODES[key] ?? 'ch'
}

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
  assertEncryptionReady()

  // Une inscription commencée est reprise, jamais recommencée : un créateur qui a fermé
  // l'onglet à mi-chemin retrouve son compte, pas un deuxième.
  const existing = await useCredential(userId, PROVIDER_ID, { target: 'APP', includePending: true })
  let accountId = existing?.secret ?? null

  if (accountId === null) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
    if (user === null) throw notFound("Ce compte n'existe pas.")
    const profile = await withUserScope(userId, (tx) =>
      tx.creatorProfile.findFirst({ where: { userId }, select: { country: true } }),
    ).catch(() => null)

    const account = await stripe.v2.core.accounts.create({
      display_name: user.name ?? user.email,
      contact_email: user.email,
      dashboard: 'full',
      identity: { country: countryCodeOf(profile?.country) },
      defaults: {
        locales: [locale === 'fr' ? 'fr' : locale === 'de' ? 'de' : locale === 'it' ? 'it' : locale === 'es' ? 'es' : 'en'],
        responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
      },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
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
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: { configurations: ['merchant'], refresh_url: refresh, return_url: ret },
    },
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

  const account = await stripe.v2.core.accounts.retrieve(existing.secret, {
    include: ['configuration.merchant', 'identity'],
  })
  const ready = account.configuration?.merchant?.capabilities?.card_payments?.status === 'active'
  const label =
    account.identity?.business_details?.registered_name ??
    account.display_name ??
    account.contact_email ??
    'Compte Stripe'
  await storeConnection(userId, stripeProvider, {
    kind: 'OAUTH',
    secret: account.id,
    accountLabel: ready ? label : null,
    status: ready ? 'CONNECTED' : 'ERROR',
    lastError: ready ? null : PENDING,
  })
  logger.info('stripe connect : retour', { userId, ready })
  return ready ? 'connecte' : 'incomplet'
}
