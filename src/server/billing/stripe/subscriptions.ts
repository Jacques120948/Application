import type Stripe from 'stripe'
import { z } from 'zod'
import { env } from '@/lib/env'
import { AppError, notFound, validation } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { getWallet } from '@/server/billing/credits'
import { FREE_PLAN_ID, getEffectivePlan } from '@/server/billing/plans'

/**
 * Abonnements Evoliia payés par Stripe.
 *
 * Ce que Stripe sait : un client, un abonnement, un tarif. Ce qu'Evoliia sait : une
 * personne, une offre, des crédits. Ce fichier fait la correspondance dans les deux sens,
 * et une seule règle tient tout : **la base d'Evoliia ne change que sur ce que Stripe
 * confirme**. Un paiement lancé n'ouvre rien ; un événement signé ouvre, ferme ou met en
 * attente.
 *
 * Les tarifs Stripe sont créés à la demande, à partir des offres du back-office. Changer
 * un prix dans l'administration crée un nouveau tarif au prochain paiement ; les abonnés
 * en cours gardent l'ancien, comme Stripe le veut.
 */

export const checkoutInput = z.object({
  planId: z.string().trim().min(1).max(48),
  locale: z.enum(['fr', 'en', 'de', 'it', 'es']).default('fr'),
})

export type SubscriptionView = {
  planId: string
  planName: string
  status: 'FREE' | 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED'
  /** Vrai quand l'abonnement est géré par Stripe (et non attribué à la main). */
  managedByStripe: boolean
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

type PlanRow = {
  id: string
  name: string
  description: string
  priceCents: number
  currency: string
  interval: string
  stripeProductId: string | null
  stripePriceId: string | null
  stripePriceFingerprint: string | null
}

/** Ce qui, s'il change, exige un nouveau tarif Stripe. */
export function priceFingerprint(plan: Pick<PlanRow, 'priceCents' | 'currency' | 'interval'>): string {
  return `${plan.priceCents}:${plan.currency.toLowerCase()}:${plan.interval}`
}

/** Statut Evoliia d'un abonnement Stripe. `null` : l'abonnement n'existe plus. */
export function statusFromStripe(
  status: Stripe.Subscription.Status,
): 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'PENDING' {
  switch (status) {
    case 'active':
      return 'ACTIVE'
    case 'trialing':
      return 'TRIALING'
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE'
    case 'incomplete':
      return 'PENDING'
    default:
      return 'CANCELED'
  }
}

function periodEndOf(sub: Stripe.Subscription): Date | null {
  const item = sub.items.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end
  const seconds = item?.current_period_end ?? legacy
  return seconds === undefined ? null : new Date(seconds * 1000)
}

/** Crée ou met à jour le produit et le tarif Stripe d'une offre. */
export async function ensureStripePrice(stripe: Stripe, planId: string): Promise<string> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } })
  if (plan === null || !plan.isActive) throw notFound("Cette offre n'existe pas.")
  if (plan.priceCents === 0) throw validation("L'offre gratuite ne se paie pas.")

  const fingerprint = priceFingerprint(plan)
  if (plan.stripePriceId !== null && plan.stripePriceFingerprint === fingerprint) return plan.stripePriceId

  let productId = plan.stripeProductId
  if (productId === null) {
    const product = await stripe.products.create({
      name: `Evoliia — ${plan.name}`,
      description: plan.description.slice(0, 400),
      metadata: { planId: plan.id },
    })
    productId = product.id
  } else {
    await stripe.products.update(productId, { name: `Evoliia — ${plan.name}` }).catch(() => undefined)
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: plan.currency.toLowerCase(),
    unit_amount: plan.priceCents,
    recurring: { interval: plan.interval === 'year' ? 'year' : 'month' },
    metadata: { planId: plan.id },
  })
  if (plan.stripePriceId !== null) {
    await stripe.prices.update(plan.stripePriceId, { active: false }).catch(() => undefined)
  }
  await prisma.plan.update({
    where: { id: plan.id },
    data: { stripeProductId: productId, stripePriceId: price.id, stripePriceFingerprint: fingerprint },
  })
  logger.info('stripe : tarif créé', { planId: plan.id, fingerprint })
  return price.id
}

export async function ensureStripeCustomer(stripe: Stripe, userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  })
  if (user === null) throw notFound("Ce compte n'existe pas.")
  if (user.stripeCustomerId !== null) return user.stripeCustomerId
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  })
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } })
  return customer.id
}

function urls(locale: string): { success: string; cancel: string; portal: string } {
  const base = `${env.appUrl.replace(/\/$/, '')}/${locale}/abonnement`
  return {
    success: `${base}?etat=succes&session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${base}?etat=annule`,
    portal: base,
  }
}

/**
 * Commence un paiement, ou change d'offre.
 *
 * Sans abonnement Stripe en cours : une page de paiement Stripe, et l'offre s'ouvrira à
 * la confirmation. Avec un abonnement Stripe en cours : le changement est demandé à
 * Stripe directement, au prorata, et appliqué dès sa réponse.
 */
export async function startCheckout(
  stripe: Stripe,
  userId: string,
  input: z.infer<typeof checkoutInput>,
): Promise<{ url: string } | { changed: true }> {
  if (input.planId === FREE_PLAN_ID) throw validation("Pour revenir à l'offre gratuite, résiliez l'abonnement en cours.")
  const priceId = await ensureStripePrice(stripe, input.planId)
  const current = await prisma.subscription.findUnique({ where: { userId } })

  if (current?.stripeSubscriptionId && current.status !== 'CANCELED') {
    const sub = await stripe.subscriptions.retrieve(current.stripeSubscriptionId)
    const item = sub.items.data[0]
    if (item !== undefined && sub.status !== 'canceled') {
      const updated = await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false,
        metadata: { userId, planId: input.planId },
      })
      await applyStripeSubscription(updated)
      return { changed: true }
    }
  }

  const customerId = await ensureStripeCustomer(stripe, userId)
  const { success, cancel } = urls(input.locale)
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: success,
    cancel_url: cancel,
    locale: input.locale === 'fr' ? 'fr' : input.locale === 'de' ? 'de' : input.locale === 'it' ? 'it' : input.locale === 'es' ? 'es' : 'en',
    allow_promotion_codes: true,
    subscription_data: { metadata: { userId, planId: input.planId } },
    metadata: { userId, planId: input.planId },
  })
  if (session.url === null) throw new AppError('INTERNAL', "Stripe n'a pas renvoyé de page de paiement.")
  logger.info('stripe : paiement commencé', { userId, planId: input.planId })
  return { url: session.url }
}

/** Le portail Stripe : moyen de paiement, factures, résiliation. */
export async function openPortal(stripe: Stripe, userId: string, locale: string): Promise<string> {
  const customerId = await ensureStripeCustomer(stripe, userId)
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: urls(locale).portal,
  })
  return session.url
}

/** Résilier à la fin de la période payée. L'offre reste ouverte jusque-là. */
export async function cancelAtPeriodEnd(stripe: Stripe, userId: string, cancel: boolean): Promise<void> {
  const current = await prisma.subscription.findUnique({ where: { userId } })
  if (!current?.stripeSubscriptionId) throw validation("Aucun abonnement Stripe n'est en cours.")
  const updated = await stripe.subscriptions.update(current.stripeSubscriptionId, { cancel_at_period_end: cancel })
  await applyStripeSubscription(updated)
}

/**
 * Après un retour de paiement : on relit la session chez Stripe plutôt que de croire
 * l'adresse de retour. La session doit appartenir à cette personne.
 */
export async function syncCheckoutSession(stripe: Stripe, userId: string, sessionId: string): Promise<boolean> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] })
  if (session.client_reference_id !== userId) return false
  const sub = session.subscription
  if (sub === null || typeof sub === 'string') return false
  await applyStripeSubscription(sub)
  return true
}

/**
 * Reporte un abonnement Stripe dans la base d'Evoliia. Idempotent : rejouer le même état
 * ne change rien.
 */
export async function applyStripeSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const userId =
    sub.metadata?.userId ??
    (await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } }))?.id
  if (userId === undefined) {
    logger.warn('stripe : abonnement sans personne connue', { subscriptionId: sub.id })
    return
  }
  const priceId = sub.items.data[0]?.price.id
  const plan = priceId === undefined ? null : await prisma.plan.findFirst({ where: { stripePriceId: priceId }, select: { id: true } })
  const planId = plan?.id ?? sub.metadata?.planId
  if (planId === undefined) {
    logger.warn('stripe : abonnement sans offre connue', { subscriptionId: sub.id })
    return
  }

  const status = statusFromStripe(sub.status)
  if (status === 'PENDING') return
  if (status === 'CANCELED') {
    await prisma.subscription.deleteMany({ where: { userId, stripeSubscriptionId: sub.id } })
    logger.info('stripe : abonnement terminé', { userId, subscriptionId: sub.id })
  } else {
    const data = {
      planId,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: periodEndOf(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }
    await prisma.subscription.upsert({ where: { userId }, update: data, create: { userId, ...data } })
    logger.info('stripe : abonnement appliqué', { userId, planId, status })
  }
  // La dotation de crédits suit l'offre, tout de suite.
  await getWallet(userId)
}

/**
 * Un événement du compte Evoliia. Traité une seule fois, quel que soit le nombre de
 * livraisons. Ce qu'on ne connaît pas est ignoré, pas refusé : Stripe n'a pas à réessayer.
 */
export async function handleStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<'handled' | 'duplicate' | 'ignored'> {
  // Une livraison déjà vue est ignorée sans bruit : Stripe rejoue volontiers.
  if ((await prisma.stripeEvent.findUnique({ where: { id: event.id }, select: { id: true } })) !== null) {
    return 'duplicate'
  }
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type, account: event.account ?? null } })
  } catch {
    return 'duplicate'
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      if (session.mode !== 'subscription' || session.subscription === null) return 'ignored'
      const sub =
        typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription
      await applyStripeSubscription(sub)
      return 'handled'
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applyStripeSubscription(event.data.object)
      return 'handled'
    case 'invoice.payment_failed': {
      const invoice = event.data.object
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
      if (customerId === undefined) return 'ignored'
      const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } })
      if (user === null) return 'ignored'
      await prisma.subscription.updateMany({ where: { userId: user.id }, data: { status: 'PAST_DUE' } })
      logger.warn('stripe : paiement échoué', { userId: user.id })
      return 'handled'
    }
    default:
      return 'ignored'
  }
}

export async function getSubscriptionView(userId: string): Promise<SubscriptionView> {
  const [plan, sub] = await Promise.all([
    getEffectivePlan(userId),
    prisma.subscription.findUnique({ where: { userId } }),
  ])
  return {
    planId: plan.id,
    planName: plan.name,
    status: sub === null ? 'FREE' : sub.status,
    managedByStripe: sub?.stripeSubscriptionId != null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
  }
}
