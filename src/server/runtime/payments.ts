import type Stripe from 'stripe'
import { z } from 'zod'
import { env } from '@/lib/env'
import { AppError, notFound, validation } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { requireOwnedProject, withOwnerRuntimeScope, withRuntimeScope } from '@/server/db/scope'
import { hasConnection, useCredential } from '@/server/integrations/service'
import { isStripeAvailable } from '@/server/billing/stripe/client'
import { logger } from '@/server/observability/logger'
import type { RuntimeSpecContext } from './context'
import type { EndUser } from './end-users'

/**
 * Paiements dans les applications créées.
 *
 * Le visiteur d'une application paie le créateur, sur le compte Stripe du créateur. Evoliia
 * crée la page de paiement au nom de ce compte connecté, puis apprend le résultat par
 * l'événement signé de Stripe — jamais par l'adresse de retour. La table `AppPurchase` est
 * cloisonnée par projet comme toute donnée d'application.
 *
 * Ce qui est vendu est ce que dit l'AppSpec au moment du paiement : le nom et le prix de
 * l'offre sont copiés dans la ligne d'achat, pour qu'un tarif modifié ensuite ne réécrive
 * pas l'histoire.
 */

export const appCheckoutInput = z.object({
  planId: z.string().trim().min(1).max(64),
})

export type PurchaseView = {
  planId: string
  planName: string
  mode: string
  status: string
  currentPeriodEnd: string | null
}

export type PaymentContext = {
  /** Le créateur a relié son compte Stripe et l'installation le permet. */
  enabled: boolean
  /** Dernier achat valable de la personne connectée. */
  purchase: PurchaseView | null
}

const LIVE_STATUSES = ['paid', 'active', 'past_due']

/** Ce que la page d'une application doit savoir pour afficher ses tarifs. */
export async function paymentContext(
  runtime: Pick<RuntimeSpecContext, 'projectId' | 'ownerId'>,
  endUserId: string | null,
): Promise<PaymentContext> {
  const enabled = isStripeAvailable() && (await hasConnection(runtime.ownerId, 'stripe', { target: 'APP' }))
  if (endUserId === null) return { enabled, purchase: null }
  const purchase = await withRuntimeScope(runtime.projectId, (tx) =>
    tx.appPurchase.findFirst({
      where: { projectId: runtime.projectId, endUserId, status: { in: LIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { planId: true, planName: true, mode: true, status: true, currentPeriodEnd: true },
    }),
  )
  return {
    enabled,
    purchase:
      purchase === null
        ? null
        : { ...purchase, currentPeriodEnd: purchase.currentPeriodEnd?.toISOString() ?? null },
  }
}

function checkoutLocale(locale: string): Stripe.Checkout.SessionCreateParams.Locale {
  return locale === 'fr' || locale === 'de' || locale === 'it' || locale === 'es' ? locale : 'en'
}

/**
 * Commence un paiement sur le compte Stripe du créateur.
 *
 * Il faut un compte dans l'application : un achat sans personne à qui le rattacher ne
 * servirait à rien. L'aperçu du studio ne paie jamais.
 */
export async function startAppCheckout(
  stripe: Stripe,
  runtime: RuntimeSpecContext,
  endUser: EndUser | null,
  planId: string,
): Promise<{ url: string }> {
  if (runtime.isOwnerPreview) {
    throw validation("L'aperçu ne permet pas de payer. Publiez l'application pour tester un paiement.")
  }
  if (endUser === null) throw new AppError('UNAUTHENTICATED', 'Créez un compte ou connectez-vous pour choisir cette offre.')

  const plan = runtime.spec.monetization.plans.find((candidate) => candidate.id === planId)
  if (plan === undefined) throw notFound("Cette offre n'existe pas.")
  if (plan.priceCents === 0) throw validation('Cette offre est gratuite : rien à payer.')

  const credential = await useCredential(runtime.ownerId, 'stripe', { target: 'APP' })
  if (credential === null) throw validation("Le paiement en ligne n'est pas activé sur cette application.")
  const accountId = credential.secret

  const currency = runtime.spec.monetization.currency.toLowerCase()
  const mode: 'payment' | 'subscription' = plan.interval === 'once' ? 'payment' : 'subscription'
  const feePercent = env.stripeApplicationFeePercent
  const base = `${env.appUrl.replace(/\/$/, '')}/a/${runtime.slug}`
  const metadata = {
    projectId: runtime.projectId,
    ownerId: runtime.ownerId,
    endUserId: endUser.id,
    planId: plan.id,
    planName: plan.name.slice(0, 120),
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode,
      customer_email: endUser.email,
      client_reference_id: endUser.id,
      locale: checkoutLocale(runtime.spec.locale),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: plan.priceCents,
            product_data: { name: `${runtime.spec.name} — ${plan.name}`.slice(0, 250) },
            ...(mode === 'subscription'
              ? { recurring: { interval: plan.interval === 'year' ? 'year' : 'month' } }
              : {}),
          },
        },
      ],
      success_url: `${base}?paiement=succes`,
      cancel_url: `${base}?paiement=annule`,
      metadata,
      ...(mode === 'subscription'
        ? {
            subscription_data: {
              metadata,
              ...(feePercent > 0 ? { application_fee_percent: feePercent } : {}),
            },
          }
        : {
            payment_intent_data: {
              metadata,
              ...(feePercent > 0
                ? { application_fee_amount: Math.round((plan.priceCents * feePercent) / 100) }
                : {}),
            },
          }),
    },
    { stripeAccount: accountId },
  )
  if (session.url === null) throw new AppError('INTERNAL', "Stripe n'a pas renvoyé de page de paiement.")
  logger.info('paiement app : commencé', { projectId: runtime.projectId, planId: plan.id, mode })
  return { url: session.url }
}

function metadataOf(source: { metadata?: Stripe.Metadata | null } | null | undefined) {
  const meta = source?.metadata ?? {}
  const projectId = meta.projectId
  const ownerId = meta.ownerId
  if (projectId === undefined || ownerId === undefined) return null
  return {
    projectId,
    ownerId,
    endUserId: meta.endUserId ?? null,
    planId: meta.planId ?? 'offre',
    planName: meta.planName ?? 'Offre',
  }
}

/**
 * Le compte connecté qui émet l'événement doit être celui du créateur désigné. Sans cela,
 * n'importe quel compte connecté pourrait fabriquer, depuis son propre tableau de bord,
 * une session portant l'identifiant du projet d'un autre.
 */
async function accountMatches(ownerId: string, account: string | undefined): Promise<boolean> {
  if (account === undefined) return false
  const credential = await useCredential(ownerId, 'stripe', { target: 'APP' })
  return credential !== null && credential.secret === account
}

/**
 * Un événement d'un compte connecté. Traité une seule fois ; ce qu'on ne connaît pas est
 * ignoré, pas refusé.
 */
export async function handleConnectEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<'handled' | 'duplicate' | 'ignored'> {
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
      const meta = metadataOf(session)
      if (meta === null || session.payment_status === 'unpaid') return 'ignored'
      if (!(await accountMatches(meta.ownerId, event.account))) {
        logger.warn('paiement app : compte connecté inattendu', { projectId: meta.projectId })
        return 'ignored'
      }
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null)
      let currentPeriodEnd: Date | null = null
      if (subscriptionId !== null) {
        const sub = await stripe.subscriptions
          .retrieve(subscriptionId, {}, { stripeAccount: event.account })
          .catch(() => null)
        currentPeriodEnd = periodEndOf(sub)
      }
      const data = {
        projectId: meta.projectId,
        endUserId: meta.endUserId,
        planId: meta.planId,
        planName: meta.planName,
        mode: session.mode,
        amountCents: session.amount_total ?? 0,
        currency: (session.currency ?? 'eur').toUpperCase(),
        status: session.mode === 'subscription' ? 'active' : 'paid',
        stripeAccountId: event.account as string,
        stripeSubscriptionId: subscriptionId,
        currentPeriodEnd,
      }
      await withOwnerRuntimeScope(meta.ownerId, meta.projectId, async (tx) => {
        await requireOwnedProject(tx, meta.projectId, meta.ownerId)
        // L'utilisateur final peut avoir disparu entre-temps : l'achat reste, sans lui.
        const endUser =
          meta.endUserId === null
            ? null
            : await tx.appEndUser.findFirst({ where: { id: meta.endUserId, projectId: meta.projectId }, select: { id: true } })
        await tx.appPurchase.upsert({
          where: { stripeSessionId: session.id },
          update: { ...data, endUserId: endUser?.id ?? null },
          create: { ...data, endUserId: endUser?.id ?? null, stripeSessionId: session.id },
        })
      })
      logger.info('paiement app : confirmé', { projectId: meta.projectId, mode: session.mode })
      return 'handled'
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      const meta = metadataOf(sub)
      if (meta === null) return 'ignored'
      if (!(await accountMatches(meta.ownerId, event.account))) return 'ignored'
      const status =
        event.type === 'customer.subscription.deleted' || sub.status === 'canceled'
          ? 'canceled'
          : sub.status === 'past_due' || sub.status === 'unpaid'
            ? 'past_due'
            : 'active'
      await withOwnerRuntimeScope(meta.ownerId, meta.projectId, (tx) =>
        tx.appPurchase.updateMany({
          where: { projectId: meta.projectId, stripeSubscriptionId: sub.id, stripeAccountId: event.account as string },
          data: { status, currentPeriodEnd: periodEndOf(sub) },
        }),
      )
      return 'handled'
    }
    default:
      return 'ignored'
  }
}

function periodEndOf(sub: Stripe.Subscription | null): Date | null {
  if (sub === null) return null
  const item = sub.items?.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end
  const seconds = item?.current_period_end ?? legacy
  return seconds === undefined ? null : new Date(seconds * 1000)
}

export type SalesView = {
  available: boolean
  connected: boolean
  totals: { count: number; amountCents: number; currency: string | null; activeSubscriptions: number }
  purchases: Array<{
    id: string
    email: string | null
    planName: string
    mode: string
    amountCents: number
    currency: string
    status: string
    createdAt: string
  }>
}

/** Les ventes d'une application, pour son créateur. */
export async function listSales(ownerId: string, projectId: string): Promise<SalesView> {
  const available = isStripeAvailable()
  const connected = available && (await hasConnection(ownerId, 'stripe', { target: 'APP' }))
  const rows = await withOwnerRuntimeScope(ownerId, projectId, async (tx) => {
    await requireOwnedProject(tx, projectId, ownerId)
    return tx.appPurchase.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        planName: true,
        mode: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
        endUser: { select: { email: true } },
      },
    })
  })
  const counted = rows.filter((row) => row.status !== 'refunded')
  return {
    available,
    connected,
    totals: {
      count: counted.length,
      amountCents: counted.reduce((sum, row) => sum + row.amountCents, 0),
      currency: counted[0]?.currency ?? null,
      activeSubscriptions: rows.filter((row) => row.mode === 'subscription' && row.status === 'active').length,
    },
    purchases: rows.slice(0, 50).map((row) => ({
      id: row.id,
      email: row.endUser?.email ?? null,
      planName: row.planName,
      mode: row.mode,
      amountCents: row.amountCents,
      currency: row.currency,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}
