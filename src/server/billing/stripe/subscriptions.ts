import { isStripeMissing, stripeMode, type StripeMode } from '@/server/billing/stripe/client'
import type Stripe from 'stripe'
import { z } from 'zod'
import { env } from '@/lib/env'
import { AppError, notFound, validation } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { getWallet } from '@/server/billing/credits'
import { FREE_PLAN_ID, getEffectivePlan } from '@/server/billing/plans'
import { reprendreRecharge, verserRecharge } from './recharges'

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

/**
 * Mensuel ou annuel.
 *
 * Le rythme est une propriété du paiement, pas de l'offre : la même offre ouvre les mêmes
 * portes dans les deux cas, seule la façon de la payer change. C'est pourquoi il voyage
 * avec la demande de paiement plutôt que dans l'identifiant de l'offre — « vis-pro-annuel »
 * aurait fait deux offres à tenir à jour, et un jour deux offres divergentes sous le même
 * nom.
 */
export const RYTHMES_PAIEMENT = ['mois', 'an'] as const

export type RythmePaiement = (typeof RYTHMES_PAIEMENT)[number]

export const checkoutInput = z.object({
  planId: z.string().trim().min(1).max(48),
  rythme: z.enum(RYTHMES_PAIEMENT).default('mois'),
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
  priceYearCents: number
  currency: string
  interval: string
  stripeProductId: string | null
  stripePriceId: string | null
  stripePriceFingerprint: string | null
  stripePriceIdYear: string | null
  stripePriceFingerprintYear: string | null
}

/**
 * Le montant d'une offre pour un rythme donné, en centimes. Zéro : ce rythme n'est pas
 * ouvert pour cette offre — c'est ainsi qu'une offre sans tarif annuel se signale.
 */
export function montantPour(
  plan: Pick<PlanRow, 'priceCents' | 'priceYearCents'>,
  rythme: RythmePaiement,
): number {
  return rythme === 'an' ? plan.priceYearCents : plan.priceCents
}

/**
 * La remise annuelle, en pourcentage entier, ou `null` quand il n'y en a pas.
 *
 * Calculée, jamais réglée : l'exploitant saisit deux prix, et le pourcentage en découle.
 * Un taux saisi à part finirait par contredire les prix qu'il prétend décrire — c'est le
 * genre d'écart qu'un client repère en une multiplication, et qui coûte la confiance qu'on
 * mettait des mois à gagner.
 *
 * Arrondi vers le bas : annoncer « 20 % » pour 19,7 % est une exagération, annoncer
 * « 19 % » pour 19,7 % n'en est pas une.
 */
export function remiseAnnuelle(
  plan: Pick<PlanRow, 'priceCents' | 'priceYearCents'>,
): number | null {
  if (plan.priceCents <= 0 || plan.priceYearCents <= 0) return null
  const plein = plan.priceCents * 12
  if (plan.priceYearCents >= plein) return null
  return Math.floor(((plein - plan.priceYearCents) / plein) * 100)
}

/**
 * Ce qui, s'il change, exige un nouveau tarif Stripe.
 *
 * Le rythme y entre au même titre que le montant : deux tarifs Stripe distincts, deux
 * empreintes distinctes. Sans cela, changer de rythme aurait réutilisé le tarif de
 * l'autre, et quelqu'un aurait payé douze fois le prix d'un mois — ou un douzième de
 * l'année.
 */
export function priceFingerprint(
  plan: Pick<PlanRow, 'priceCents' | 'priceYearCents' | 'currency' | 'interval'>,
  rythme: RythmePaiement = 'mois',
  mode: StripeMode = stripeMode(),
): string {
  // Le mode fait partie de l'empreinte : un tarif créé en test n'existe pas en production,
  // et la première demande de paiement après le passage en production le recrée d'elle-même.
  const periode = rythme === 'an' ? 'year' : plan.interval
  return `${mode}:${montantPour(plan, rythme)}:${plan.currency.toLowerCase()}:${periode}`
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

/**
 * Crée ou met à jour le produit et le tarif Stripe d'une offre, pour un rythme donné.
 *
 * Un seul produit Stripe par offre, deux tarifs accrochés dessus : c'est ainsi que Stripe
 * lui-même range un abonnement payable au mois ou à l'année, et cela laisse au client une
 * facture au bon nom quel que soit le rythme choisi.
 *
 * Demander l'année à une offre qui n'en a pas est refusé plutôt que rattrapé en mensuel :
 * un paiement lancé sur un rythme qu'on n'a pas choisi est la pire façon de découvrir une
 * erreur de réglage.
 */
export async function ensureStripePrice(
  stripe: Stripe,
  planId: string,
  rythme: RythmePaiement = 'mois',
): Promise<string> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } })
  if (plan === null || !plan.isActive) throw notFound("Cette offre n'existe pas.")
  if (plan.priceCents === 0) throw validation("L'offre gratuite ne se paie pas.")
  const montant = montantPour(plan, rythme)
  if (montant <= 0) throw validation("Cette offre ne se prend pas à l'année.")

  const annuel = rythme === 'an'
  const fingerprint = priceFingerprint(plan, rythme)
  const connu = annuel ? plan.stripePriceIdYear : plan.stripePriceId
  const empreinteConnue = annuel ? plan.stripePriceFingerprintYear : plan.stripePriceFingerprint
  if (connu !== null && empreinteConnue === fingerprint) return connu

  /*
   * Le produit se retrouve par l'une ou l'autre empreinte : le tarif annuel d'une offre
   * dont seul le mensuel existait doit s'accrocher au produit déjà créé, sinon le client
   * verrait deux lignes « Evoliia — Pro » sans savoir laquelle est la sienne.
   */
  const prefixe = `${stripeMode()}:`
  const sameMode =
    plan.stripePriceFingerprint?.startsWith(prefixe) === true ||
    plan.stripePriceFingerprintYear?.startsWith(prefixe) === true
  let productId = sameMode ? plan.stripeProductId : null
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
    unit_amount: montant,
    recurring: { interval: annuel || plan.interval === 'year' ? 'year' : 'month' },
    metadata: { planId: plan.id, rythme },
  })
  /*
   * L'ancien tarif du **même** rythme est désactivé, jamais celui de l'autre : éteindre le
   * mensuel en créant l'annuel empêcherait toute nouvelle souscription au mois.
   */
  if (connu !== null && empreinteConnue?.startsWith(prefixe) === true) {
    await stripe.prices.update(connu, { active: false }).catch(() => undefined)
  }
  await prisma.plan.update({
    where: { id: plan.id },
    data: annuel
      ? {
          stripeProductId: productId,
          stripePriceIdYear: price.id,
          stripePriceFingerprintYear: fingerprint,
        }
      : {
          stripeProductId: productId,
          stripePriceId: price.id,
          stripePriceFingerprint: fingerprint,
        },
  })
  logger.info('stripe : tarif créé', { planId: plan.id, fingerprint, rythme })
  return price.id
}

export async function ensureStripeCustomer(stripe: Stripe, userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  })
  if (user === null) throw notFound("Ce compte n'existe pas.")
  if (user.stripeCustomerId !== null) {
    // Le client gardé en base peut venir de l'autre mode (test → production) ou avoir été
    // supprimé dans Stripe : on le vérifie avant de l'utiliser, et on le recrée sinon.
    const known = await stripe.customers
      .retrieve(user.stripeCustomerId)
      .then((customer) => !('deleted' in customer && customer.deleted === true))
      .catch((error: unknown) => {
        if (isStripeMissing(error)) return false
        throw error
      })
    if (known) return user.stripeCustomerId
    logger.info('stripe : client inconnu dans ce mode, recréé', { userId })
  }
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
  const priceId = await ensureStripePrice(stripe, input.planId, input.rythme)
  const current = await prisma.subscription.findUnique({ where: { userId } })

  if (current?.stripeSubscriptionId && current.status !== 'CANCELED') {
    const sub = await retrieveOrForget(stripe, userId, current.stripeSubscriptionId)
    const item = sub?.items.data[0]
    if (sub !== null && item !== undefined && sub.status !== 'canceled') {
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
  logger.info('stripe : paiement commencé', { userId, planId: input.planId, rythme: input.rythme })
  return { url: session.url }
}

/**
 * Relit un abonnement chez Stripe. S'il n'y existe pas — abonnement du mode test après le
 * passage en production, ou supprimé à la main — la ligne d'Evoliia est un orphelin : on
 * l'efface, la personne retombe sur l'offre gratuite et peut souscrire pour de vrai.
 * L'alternative, garder une offre ouverte que personne ne paie, coûterait à Evoliia.
 */
async function retrieveOrForget(
  stripe: Stripe,
  userId: string,
  subscriptionId: string,
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error) {
    if (!isStripeMissing(error)) throw error
    await prisma.subscription.deleteMany({ where: { userId, stripeSubscriptionId: subscriptionId } })
    logger.warn('stripe : abonnement inconnu dans ce mode, ligne retirée', { userId, subscriptionId })
    return null
  }
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
  const sub = await retrieveOrForget(stripe, userId, current.stripeSubscriptionId)
  if (sub === null) {
    throw validation("Cet abonnement n'existe plus chez Stripe : l'offre a été retirée. Vous pouvez en choisir une nouvelle.")
  }
  const updated = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: cancel })
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
 *
 * **Un événement dont le traitement échoue n'est pas « vu ».** Il était noté avant d'être
 * traité, et la note restait si le traitement levait une erreur : la nouvelle livraison de
 * Stripe passait alors pour un doublon, et l'événement était perdu pour de bon — pour une
 * recharge, un paiement encaissé sans crédits versés. La note est désormais retirée quand
 * le traitement échoue, pour que la livraison suivante le reprenne. Traiter deux fois reste
 * sans danger : chaque traitement est idempotent de lui-même (un abonnement se réécrit à
 * l'identique, un paiement ne crédite qu'une fois, la base y veille).
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

  try {
    return await traiterEvenement(stripe, event)
  } catch (error) {
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => undefined)
    throw error
  }
}

async function traiterEvenement(stripe: Stripe, event: Stripe.Event): Promise<'handled' | 'duplicate' | 'ignored'> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      // Une recharge se paie une fois : ses crédits sont versés ici, jamais au retour du navigateur.
      if (session.mode === 'payment') return verserRecharge(session)
      if (session.mode !== 'subscription' || session.subscription === null) return 'ignored'
      const sub =
        typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription
      await applyStripeSubscription(sub)
      return 'handled'
    }
    // Un moyen de paiement différé (virement, prélèvement) : payé plus tard, versé à ce moment-là.
    case 'checkout.session.async_payment_succeeded':
      return verserRecharge(event.data.object)
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
    case 'charge.refunded': {
      const charge = event.data.object
      // Une recharge remboursée : les crédits qui en restent sont repris.
      const recharge = await reprendreRecharge(charge)
      if (recharge !== 'ignored') return recharge
      // Un remboursement d'abonnement fait depuis le tableau de bord Stripe d'Evoliia : on le
      // note, sans toucher à l'offre. La fermer est une décision à prendre dans le back-office.
      const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id
      const user =
        customerId === undefined
          ? null
          : await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } })
      logger.info('stripe : remboursement constaté', { userId: user?.id ?? null, amount: charge.amount_refunded })
      return user === null ? 'ignored' : 'handled'
    }
    default:
      return 'ignored'
  }
}

/**
 * Rembourse la dernière facture d'un abonné, et le cas échéant ferme son abonnement
 * sur-le-champ. Réservé au back-office : c'est l'argent d'Evoliia qui repart.
 */
export async function refundLastPayment(
  stripe: Stripe,
  userId: string,
  options: { cancel: boolean },
): Promise<{ refundedCents: number; canceled: boolean }> {
  const current = await prisma.subscription.findUnique({ where: { userId } })
  if (!current?.stripeSubscriptionId) throw validation("Aucun abonnement Stripe n'est en cours pour ce compte.")

  const sub = await stripe.subscriptions.retrieve(current.stripeSubscriptionId, {
    expand: ['latest_invoice.payments'],
  })
  const invoice = typeof sub.latest_invoice === 'string' ? null : sub.latest_invoice
  const payment = invoice?.payments?.data.find((candidate) => candidate.status === 'paid')
  const ref = payment?.payment.payment_intent
  const paymentIntentId = typeof ref === 'string' ? ref : (ref?.id ?? null)
  if (paymentIntentId === null) throw validation('Aucun paiement à rembourser sur la dernière facture.')

  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId, metadata: { userId } })
  let canceled = false
  if (options.cancel && sub.status !== 'canceled') {
    const closed = await stripe.subscriptions.cancel(sub.id)
    await applyStripeSubscription(closed)
    canceled = true
  }
  logger.info('stripe : remboursement effectué', { userId, amount: refund.amount, canceled })
  return { refundedCents: refund.amount, canceled }
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
