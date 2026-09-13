import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withRuntimeScope, withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS, FREE_PLAN_ID, getEffectivePlan } from '@/server/billing/plans'
import { getWallet } from '@/server/billing/credits'
import {
  applyStripeSubscription,
  ensureStripePrice,
  getSubscriptionView,
  handleStripeEvent,
  startCheckout,
} from '@/server/billing/stripe/subscriptions'
import { completeStripeOnboarding, startStripeOnboarding } from '@/server/integrations/providers/stripe'
import { hasConnection, listConnections, useCredential } from '@/server/integrations/service'
import {
  handleConnectEvent,
  listSales,
  paymentContext,
  startAppCheckout,
} from '@/server/runtime/payments'
import type { RuntimeSpecContext } from '@/server/runtime/context'
import { DEMO_APPS } from '@/server/demos/catalog'
import { parseAppSpec } from '@/server/spec/validate'

/**
 * Stripe de bout en bout, sans jamais appeler Stripe.
 *
 * Un faux client remplace le SDK : il enregistre ce qu'on lui demande et répond ce qu'un
 * vrai Stripe répondrait. Ce qui est éprouvé est ce qui nous appartient : la base ne
 * change que sur un événement confirmé, un événement n'est traité qu'une fois, un compte
 * connecté ne peut pas parler au nom d'un autre, et un créateur ne voit que ses ventes.
 */

const PAID_PLAN = 'launch'
const SPEC = parseAppSpec({
  ...DEMO_APPS[0]!.spec,
  name: 'Boutique de test',
  monetization: {
    model: 'subscription',
    currency: 'EUR',
    plans: [
      { id: 'gratuit', name: 'Découverte', priceCents: 0, interval: 'month', features: ['Un aperçu'], highlighted: false },
      { id: 'pro', name: 'Pro', priceCents: 900, interval: 'month', features: ['Tout'], highlighted: true },
      { id: 'pack', name: 'Pack', priceCents: 1500, interval: 'once', features: ['Une fois'], highlighted: false },
    ],
  },
})

let counter = 0
const next = (prefix: string) => `${prefix}_${++counter}`

/** Un abonnement Stripe tel que le webhook le livrerait. */
function fakeSubscription(params: {
  id?: string
  customer: string
  priceId: string
  status?: Stripe.Subscription.Status
  userId: string
  planId: string
  cancelAtPeriodEnd?: boolean
}): Stripe.Subscription {
  const end = Math.floor(Date.now() / 1000) + 30 * 86_400
  return {
    id: params.id ?? next('sub'),
    object: 'subscription',
    customer: params.customer,
    status: params.status ?? 'active',
    cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
    metadata: { userId: params.userId, planId: params.planId },
    items: { object: 'list', data: [{ id: next('si'), price: { id: params.priceId }, current_period_end: end }] },
  } as unknown as Stripe.Subscription
}

const created = {
  sessions: [] as Array<{ params: Stripe.Checkout.SessionCreateParams; options?: Stripe.RequestOptions }>,
  accounts: 0,
}

const fake = {
  products: {
    create: vi.fn(async () => ({ id: next('prod') })),
    update: vi.fn(async () => ({})),
  },
  prices: {
    create: vi.fn(async () => ({ id: next('price') })),
    update: vi.fn(async () => ({})),
  },
  customers: { create: vi.fn(async () => ({ id: next('cus') })) },
  checkout: {
    sessions: {
      create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
        created.sessions.push({ params, options })
        return { id: next('cs'), url: `https://checkout.stripe.test/${counter}` }
      }),
      retrieve: vi.fn(),
    },
  },
  subscriptions: {
    retrieve: vi.fn(),
    update: vi.fn(),
  },
  billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'https://portail.stripe.test' })) } },
  accounts: {
    create: vi.fn(async () => {
      created.accounts += 1
      return { id: 'acct_test_1' }
    }),
    retrieve: vi.fn(async (id: string) => ({
      id,
      charges_enabled: true,
      email: 'boutique@exemple.test',
      business_profile: { name: 'Ma boutique' },
    })),
  },
  accountLinks: { create: vi.fn(async () => ({ url: 'https://connect.stripe.test/inscription' })) },
} as unknown as Stripe

function event(type: string, object: unknown, account?: string): Stripe.Event {
  return {
    // La table des événements est globale et survit aux suites : identifiant unique.
    id: `evt_${randomUUID()}`,
    object: 'event',
    type,
    account,
    data: { object },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    api_version: '2025-01-01',
  } as unknown as Stripe.Event
}

let creator: string
let neighbour: string
let projectId: string
let endUserId: string

async function creerCreateur(planId: string | null): Promise<string> {
  const account = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  if (planId !== null) {
    await prisma.subscription.create({ data: { userId: account.userId, planId, status: 'ACTIVE' } })
  }
  return account.userId
}

async function publier(ownerId: string): Promise<string> {
  return withUserScope(ownerId, async (tx) => {
    const project = await tx.project.create({
      data: {
        ownerId,
        name: SPEC.name,
        slug: `stripe-${randomUUID()}`,
        draftSpec: SPEC as unknown as object,
        status: 'PUBLISHED',
        locale: 'fr',
      },
      select: { id: true },
    })
    const version = await tx.projectVersion.create({
      data: { projectId: project.id, number: 1, label: 'Test', spec: SPEC as unknown as object },
      select: { id: true },
    })
    await tx.project.update({
      where: { id: project.id },
      data: { publishedVersionId: version.id, publishedAt: new Date() },
    })
    return project.id
  })
}

function runtime(ownerId: string, id: string, preview = false): RuntimeSpecContext {
  return { projectId: id, slug: 'boutique-test', spec: SPEC, ownerId, isOwnerPreview: preview }
}

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_faux'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_faux'
  process.env.STRIPE_APPLICATION_FEE_PERCENT = '0'
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  clearAll()
  creator = await creerCreateur('builder')
  neighbour = await creerCreateur(null)
  projectId = await publier(creator)
  endUserId = await withRuntimeScope(projectId, async (tx) =>
    (
      await tx.appEndUser.create({
        data: { projectId, email: 'client@exemple.test', passwordHash: 'x' },
        select: { id: true },
      })
    ).id,
  )
}, 60_000)

afterAll(async () => {
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  await prisma.plan.update({
    where: { id: PAID_PLAN },
    data: { stripeProductId: null, stripePriceId: null, stripePriceFingerprint: null },
  }).catch(() => undefined)
  await prisma.user.deleteMany({ where: { id: { in: [creator, neighbour] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Abonnements Evoliia', () => {
  let subscriber: string
  let priceId: string

  beforeAll(async () => {
    subscriber = await creerCreateur(null)
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: subscriber } }).catch(() => undefined)
  })

  it('crée le tarif Stripe une fois, et le recrée seulement si le prix change', async () => {
    priceId = await ensureStripePrice(fake, PAID_PLAN)
    expect(priceId).toMatch(/^price_/)
    expect(await ensureStripePrice(fake, PAID_PLAN)).toBe(priceId)
    expect(fake.prices.create).toHaveBeenCalledTimes(1)

    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: PAID_PLAN } })
    await prisma.plan.update({ where: { id: PAID_PLAN }, data: { priceCents: plan.priceCents + 100 } })
    const renewed = await ensureStripePrice(fake, PAID_PLAN)
    expect(renewed).not.toBe(priceId)
    expect(fake.prices.update).toHaveBeenCalledWith(priceId, { active: false })
    await prisma.plan.update({ where: { id: PAID_PLAN }, data: { priceCents: plan.priceCents } })
    priceId = await ensureStripePrice(fake, PAID_PLAN)
  })

  it('refuse de faire payer l’offre gratuite', async () => {
    await expect(startCheckout(fake, subscriber, { planId: FREE_PLAN_ID, locale: 'fr' })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('ouvre une page de paiement rattachée à la personne, sans rien changer en base', async () => {
    const result = await startCheckout(fake, subscriber, { planId: PAID_PLAN, locale: 'fr' })
    expect(result).toHaveProperty('url')
    const last = created.sessions.at(-1)!
    expect(last.params.mode).toBe('subscription')
    expect(last.params.client_reference_id).toBe(subscriber)
    expect(last.params.metadata).toMatchObject({ userId: subscriber, planId: PAID_PLAN })
    expect(last.params.success_url).toContain('/fr/abonnement?etat=succes')
    // Rien n'est ouvert tant que Stripe n'a pas confirmé.
    expect((await getEffectivePlan(subscriber)).id).toBe(FREE_PLAN_ID)
  })

  it('ouvre l’offre et dote les crédits sur un abonnement confirmé', async () => {
    const before = (await getWallet(subscriber)).balance
    const customer = (await prisma.user.findUniqueOrThrow({ where: { id: subscriber } })).stripeCustomerId!
    const sub = fakeSubscription({ customer, priceId, userId: subscriber, planId: PAID_PLAN })
    await applyStripeSubscription(sub)

    const view = await getSubscriptionView(subscriber)
    expect(view).toMatchObject({ planId: PAID_PLAN, status: 'ACTIVE', managedByStripe: true })
    expect(view.currentPeriodEnd).not.toBeNull()
    expect((await getWallet(subscriber)).balance).toBeGreaterThan(before)

    // Rejouer le même état ne change rien.
    await applyStripeSubscription(sub)
    expect((await getSubscriptionView(subscriber)).status).toBe('ACTIVE')
  })

  it('n’ouvre rien pour un abonnement dont le paiement n’a pas abouti', async () => {
    const other = await creerCreateur(null)
    const sub = fakeSubscription({ customer: 'cus_inconnu', priceId, userId: other, planId: PAID_PLAN, status: 'incomplete' })
    await applyStripeSubscription(sub)
    expect((await getEffectivePlan(other)).id).toBe(FREE_PLAN_ID)
    await prisma.user.delete({ where: { id: other } })
  })

  it('change d’offre directement quand un abonnement Stripe existe déjà', async () => {
    const current = await prisma.subscription.findUniqueOrThrow({ where: { userId: subscriber } })
    const customer = current.stripeCustomerId!
    vi.mocked(fake.subscriptions.retrieve).mockResolvedValueOnce(
      fakeSubscription({ id: current.stripeSubscriptionId!, customer, priceId, userId: subscriber, planId: PAID_PLAN }) as never,
    )
    const builderPrice = await ensureStripePrice(fake, 'builder')
    vi.mocked(fake.subscriptions.update).mockResolvedValueOnce(
      fakeSubscription({ id: current.stripeSubscriptionId!, customer, priceId: builderPrice, userId: subscriber, planId: 'builder' }) as never,
    )
    const result = await startCheckout(fake, subscriber, { planId: 'builder', locale: 'fr' })
    expect(result).toEqual({ changed: true })
    expect((await getSubscriptionView(subscriber)).planId).toBe('builder')
    await prisma.plan.update({
      where: { id: 'builder' },
      data: { stripeProductId: null, stripePriceId: null, stripePriceFingerprint: null },
    })
  })

  it('traite un événement une seule fois, et ignore ce qu’il ne connaît pas', async () => {
    const current = await prisma.subscription.findUniqueOrThrow({ where: { userId: subscriber } })
    const sub = fakeSubscription({
      id: current.stripeSubscriptionId!,
      customer: current.stripeCustomerId!,
      priceId,
      userId: subscriber,
      planId: PAID_PLAN,
      cancelAtPeriodEnd: true,
    })
    const evt = event('customer.subscription.updated', sub)
    expect(await handleStripeEvent(fake, evt)).toBe('handled')
    expect((await getSubscriptionView(subscriber)).cancelAtPeriodEnd).toBe(true)
    expect(await handleStripeEvent(fake, evt)).toBe('duplicate')
    expect(await handleStripeEvent(fake, event('product.created', { id: 'prod_x' }))).toBe('ignored')
  })

  it('ferme l’offre quand Stripe termine l’abonnement', async () => {
    const current = await prisma.subscription.findUniqueOrThrow({ where: { userId: subscriber } })
    const sub = fakeSubscription({
      id: current.stripeSubscriptionId!,
      customer: current.stripeCustomerId!,
      priceId,
      userId: subscriber,
      planId: PAID_PLAN,
      status: 'canceled',
    })
    expect(await handleStripeEvent(fake, event('customer.subscription.deleted', sub))).toBe('handled')
    expect((await getSubscriptionView(subscriber)).status).toBe('FREE')
  })

  it('n’accepte au webhook qu’un événement signé', async () => {
    const { POST } = await import('@/app/api/stripe/webhook/route')
    const payload = JSON.stringify(event('product.created', { id: 'prod_signe' }))
    const signer = new Stripe('sk_test_faux')
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_faux' })

    const signed = await POST(
      new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body: payload,
      }),
    )
    expect(signed.status).toBe(200)
    expect(await signed.json()).toMatchObject({ received: true, outcome: 'ignored' })

    const forged = await POST(
      new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=faux' },
        body: payload,
      }),
    )
    expect(forged.status).toBe(401)

    const saved = process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_WEBHOOK_SECRET
    const absent = await POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: payload }))
    expect(absent.status).toBe(404)
    process.env.STRIPE_WEBHOOK_SECRET = saved
  })
})

describe('Stripe Connect — le créateur encaisse ses clients', () => {
  it('ouvre un compte connecté une seule fois et garde l’inscription en attente', async () => {
    const url = await startStripeOnboarding(fake, creator, 'fr')
    expect(url).toContain('connect.stripe.test')
    expect(created.accounts).toBe(1)

    const entry = (await listConnections(creator)).find((row) => row.provider.id === 'stripe')
    expect(entry?.connection?.status).toBe('ERROR')
    expect(entry?.connection?.lastError).toContain('à terminer')
    expect(await hasConnection(creator, 'stripe', { target: 'APP' })).toBe(false)

    // Reprendre l'inscription ne crée pas un second compte.
    await startStripeOnboarding(fake, creator, 'fr')
    expect(created.accounts).toBe(1)
  })

  it('refuse à une offre sans connexion possible', async () => {
    await expect(startStripeOnboarding(fake, neighbour, 'fr')).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
  })

  it('relie le compte au retour de Stripe, sans exposer autre chose que son identifiant', async () => {
    expect(await completeStripeOnboarding(fake, creator)).toBe('connecte')
    expect(await hasConnection(creator, 'stripe', { target: 'APP' })).toBe(true)
    const entry = (await listConnections(creator)).find((row) => row.provider.id === 'stripe')
    expect(entry?.connection?.accountLabel).toBe('Ma boutique')
    expect((await useCredential(creator, 'stripe', { target: 'APP' }))?.secret).toBe('acct_test_1')
    expect((await paymentContext(runtime(creator, projectId), null)).enabled).toBe(true)
    expect((await paymentContext(runtime(neighbour, projectId), null)).enabled).toBe(false)
  })

  it('n’ouvre un paiement que pour une personne connectée, hors aperçu, sur une offre payante', async () => {
    const endUser = { id: endUserId, email: 'client@exemple.test', displayName: null }
    await expect(startAppCheckout(fake, runtime(creator, projectId, true), endUser, 'pro')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(startAppCheckout(fake, runtime(creator, projectId), null, 'pro')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    await expect(startAppCheckout(fake, runtime(creator, projectId), endUser, 'gratuit')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    await expect(startAppCheckout(fake, runtime(creator, projectId), endUser, 'inconnue')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('crée la page de paiement sur le compte du créateur, jamais sur celui d’Evoliia', async () => {
    const endUser = { id: endUserId, email: 'client@exemple.test', displayName: null }
    const result = await startAppCheckout(fake, runtime(creator, projectId), endUser, 'pro')
    expect(result.url).toContain('checkout.stripe.test')
    const last = created.sessions.at(-1)!
    expect(last.options).toEqual({ stripeAccount: 'acct_test_1' })
    expect(last.params.mode).toBe('subscription')
    expect(last.params.metadata).toMatchObject({ projectId, ownerId: creator, endUserId, planId: 'pro' })
    expect(last.params.line_items?.[0]?.price_data).toMatchObject({ currency: 'eur', unit_amount: 900 })
    expect(last.params.subscription_data).not.toHaveProperty('application_fee_percent')

    process.env.STRIPE_APPLICATION_FEE_PERCENT = '10'
    await startAppCheckout(fake, runtime(creator, projectId), endUser, 'pack')
    const pack = created.sessions.at(-1)!
    expect(pack.params.mode).toBe('payment')
    expect(pack.params.payment_intent_data?.application_fee_amount).toBe(150)
    process.env.STRIPE_APPLICATION_FEE_PERCENT = '0'
  })

  it('enregistre la vente sur l’événement signé, et seulement du bon compte connecté', async () => {
    const last = created.sessions.at(-1)!
    const session = {
      id: 'cs_vente_1',
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 1500,
      currency: 'eur',
      subscription: null,
      metadata: last.params.metadata,
    }
    // Un autre compte connecté qui rejouerait ces métadonnées est ignoré.
    expect(await handleConnectEvent(fake, event('checkout.session.completed', session, 'acct_autre'))).toBe('ignored')
    expect((await listSales(creator, projectId)).totals.count).toBe(0)

    const evt = event('checkout.session.completed', session, 'acct_test_1')
    expect(await handleConnectEvent(fake, evt)).toBe('handled')
    expect(await handleConnectEvent(fake, evt)).toBe('duplicate')

    const sales = await listSales(creator, projectId)
    expect(sales.totals).toMatchObject({ count: 1, amountCents: 1500, currency: 'EUR' })
    expect(sales.purchases[0]).toMatchObject({ email: 'client@exemple.test', planName: 'Pack', status: 'paid' })

    const context = await paymentContext(runtime(creator, projectId), endUserId)
    expect(context.purchase).toMatchObject({ planId: 'pack', status: 'paid' })
  })

  it('suit un abonnement du client jusqu’à sa résiliation', async () => {
    const pro = created.sessions.find(
      (entry) => entry.params.mode === 'subscription' && entry.options?.stripeAccount === 'acct_test_1',
    )!
    vi.mocked(fake.subscriptions.retrieve).mockResolvedValueOnce(
      fakeSubscription({ id: 'sub_client_1', customer: 'cus_client', priceId: 'price_x', userId: '', planId: 'pro' }) as never,
    )
    const session = {
      id: 'cs_vente_2',
      object: 'checkout.session',
      mode: 'subscription',
      payment_status: 'paid',
      amount_total: 900,
      currency: 'eur',
      subscription: 'sub_client_1',
      metadata: pro.params.metadata,
    }
    expect(await handleConnectEvent(fake, event('checkout.session.completed', session, 'acct_test_1'))).toBe('handled')
    let sales = await listSales(creator, projectId)
    expect(sales.totals.activeSubscriptions).toBe(1)
    expect(sales.purchases.find((row) => row.mode === 'subscription')?.status).toBe('active')

    const sub = { id: 'sub_client_1', object: 'subscription', status: 'canceled', metadata: pro.params.metadata, items: { data: [] } }
    expect(await handleConnectEvent(fake, event('customer.subscription.deleted', sub, 'acct_test_1'))).toBe('handled')
    sales = await listSales(creator, projectId)
    expect(sales.totals.activeSubscriptions).toBe(0)
    expect(sales.purchases.find((row) => row.mode === 'subscription')?.status).toBe('canceled')
  })

  it('ne montre les ventes qu’au créateur de l’application', async () => {
    await expect(listSales(neighbour, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const hidden = await withRuntimeScope(randomUUID(), (tx) => tx.appPurchase.count())
    expect(hidden).toBe(0)
  })
})
