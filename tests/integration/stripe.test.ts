import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withRuntimeScope, withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS, FREE_PLAN_ID, getEffectivePlan } from '@/server/billing/plans'
import { getWallet, spendCredits } from '@/server/billing/credits'
import { DEFAULT_CREDIT_PACKS } from '@/server/billing/packs'
import { commencerRecharge } from '@/server/billing/stripe/recharges'
import {
  applyStripeSubscription,
  ensureStripePrice,
  getSubscriptionView,
  handleStripeEvent,
  refundLastPayment,
  startCheckout,
} from '@/server/billing/stripe/subscriptions'
import { completeStripeOnboarding, startStripeOnboarding } from '@/server/integrations/providers/stripe'
import { hasConnection, listConnections, useCredential } from '@/server/integrations/service'
import {
  handleConnectEvent,
  listSales,
  paymentContext,
  refundPurchase,
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
const ZERO_PLAN = 'test-stripe-zero'
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
  refunds: [] as Array<{ payment_intent: string; amount?: number; refund_application_fee?: boolean }>,
  accounts: 0,
  accountParams: null as null | { dashboard: string; defaults?: { responsibilities?: Record<string, string> } },
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
  customers: {
    create: vi.fn(async () => ({ id: next('cus') })),
    retrieve: vi.fn(async (id: string) => ({ id, object: 'customer' })),
  },
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
    cancel: vi.fn(async (id: string) => ({ id, object: 'subscription', status: 'canceled', items: { data: [] }, metadata: {} })),
  },
  refunds: {
    create: vi.fn(async (params: { payment_intent: string; amount?: number }) => {
      created.refunds.push(params)
      return { id: next('re'), amount: params.amount ?? 0 }
    }),
  },
  paymentIntents: { retrieve: vi.fn(async () => ({ metadata: {} })) },
  invoices: { list: vi.fn(async () => ({ data: [] })) },
  billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'https://portail.stripe.test' })) } },
  v2: {
    core: {
      accounts: {
        create: vi.fn(async (params: { dashboard: string; defaults?: { responsibilities?: Record<string, string> } }) => {
          created.accounts += 1
          created.accountParams = params
          return { id: 'acct_test_1' }
        }),
        retrieve: vi.fn(async (id: string) => ({
          id,
          display_name: 'Ma boutique',
          contact_email: 'boutique@exemple.test',
          configuration: { merchant: { capabilities: { card_payments: { status: 'active' } } } },
        })),
      },
      accountLinks: { create: vi.fn(async () => ({ url: 'https://connect.stripe.test/inscription' })) },
    },
  },
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
  /*
   * Le voisin reçoit une offre de test sans connexion possible, plutôt que l'offre
   * gratuite : une autre suite modifie celle-ci en parallèle, et ce test ne doit dépendre
   * que de lui-même.
   */
  const free = DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)!
  await prisma.plan.upsert({
    where: { id: ZERO_PLAN },
    update: { maxConnections: 0 },
    create: { ...free, id: ZERO_PLAN, name: 'Sans connexion (test)', features: [], maxConnections: 0, isActive: false, currency: 'EUR', interval: 'month' },
  })
  clearAll()
  creator = await creerCreateur('builder')
  neighbour = await creerCreateur(ZERO_PLAN)
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
  await prisma.plan.delete({ where: { id: ZERO_PLAN } }).catch(() => undefined)
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

  it('recrée produit et tarif au passage en production, sans toucher à ceux du mode test', async () => {
    const before = await prisma.plan.findUniqueOrThrow({ where: { id: PAID_PLAN } })
    expect(before.stripePriceFingerprint).toMatch(/^test:/)
    const previous = process.env.STRIPE_SECRET_KEY
    process.env.STRIPE_SECRET_KEY = 'sk_live' + '_faux'
    const productsBefore = vi.mocked(fake.products.create).mock.calls.length
    const updatesBefore = vi.mocked(fake.prices.update).mock.calls.length
    try {
      const livePrice = await ensureStripePrice(fake, PAID_PLAN)
      expect(livePrice).not.toBe(priceId)
      expect(vi.mocked(fake.products.create).mock.calls.length).toBe(productsBefore + 1)
      expect(vi.mocked(fake.prices.update).mock.calls.length).toBe(updatesBefore)
      const after = await prisma.plan.findUniqueOrThrow({ where: { id: PAID_PLAN } })
      expect(after.stripePriceFingerprint).toMatch(/^live:/)
      expect(after.stripeProductId).not.toBe(before.stripeProductId)
    } finally {
      process.env.STRIPE_SECRET_KEY = previous
      priceId = await ensureStripePrice(fake, PAID_PLAN)
    }
  })

  /**
   * L'année et le mois sont deux tarifs distincts chez Stripe, accrochés au même produit.
   *
   * Ce qui est protégé ici est ce qui coûterait le plus cher à réparer : créer le tarif
   * annuel ne doit pas désactiver le mensuel — plus personne ne pourrait souscrire au mois
   * — et les deux identifiants doivent rester dans leurs colonnes respectives, sous peine
   * de faire payer douze fois le prix d'un mois à quelqu'un qui a choisi le mois.
   */
  it('crée un tarif annuel à part, sans éteindre le mensuel', async () => {
    const avant = await prisma.plan.findUniqueOrThrow({ where: { id: PAID_PLAN } })
    await prisma.plan.update({
      where: { id: PAID_PLAN },
      data: { priceYearCents: avant.priceCents * 10 },
    })
    const updatesAvant = vi.mocked(fake.prices.update).mock.calls.length
    try {
      const annuel = await ensureStripePrice(fake, PAID_PLAN, 'an')
      expect(annuel).not.toBe(priceId)

      const apres = await prisma.plan.findUniqueOrThrow({ where: { id: PAID_PLAN } })
      expect(apres.stripePriceIdYear).toBe(annuel)
      // Le mensuel n'a pas bougé d'un iota, et n'a pas été désactivé chez Stripe.
      expect(apres.stripePriceId).toBe(priceId)
      expect(apres.stripeProductId).toBe(avant.stripeProductId)
      expect(vi.mocked(fake.prices.update).mock.calls.length).toBe(updatesAvant)
      expect(apres.stripePriceFingerprintYear).toContain(':year')

      // Redemandé, il est réutilisé : un tarif ne se recrée que si son montant change.
      expect(await ensureStripePrice(fake, PAID_PLAN, 'an')).toBe(annuel)
      // Et le mensuel reste servi par sa propre colonne.
      expect(await ensureStripePrice(fake, PAID_PLAN, 'mois')).toBe(priceId)
    } finally {
      await prisma.plan.update({
        where: { id: PAID_PLAN },
        data: { priceYearCents: 0, stripePriceIdYear: null, stripePriceFingerprintYear: null },
      })
    }
  })

  /*
   * Une offre sans tarif annuel refuse l'année plutôt que de retomber sur le mensuel : un
   * paiement lancé sur un rythme qu'on n'a pas choisi est la pire façon de découvrir une
   * erreur de réglage — on s'en aperçoit sur le relevé bancaire.
   */
  it('refuse l’année à une offre qui n’en a pas', async () => {
    await expect(ensureStripePrice(fake, PAID_PLAN, 'an')).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('refuse de faire payer l’offre gratuite', async () => {
    await expect(startCheckout(fake, subscriber, { planId: FREE_PLAN_ID, rythme: 'mois', locale: 'fr' })).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })

  it('ouvre une page de paiement rattachée à la personne, sans rien changer en base', async () => {
    const result = await startCheckout(fake, subscriber, { planId: PAID_PLAN, rythme: 'mois', locale: 'fr' })
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
    const result = await startCheckout(fake, subscriber, { planId: 'builder', rythme: 'mois', locale: 'fr' })
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

  it('rembourse la dernière facture d’un abonné et ferme son offre, depuis le back-office', async () => {
    const paying = await creerCreateur(null)
    const customer = `cus_${randomUUID()}`
    await prisma.user.update({ where: { id: paying }, data: { stripeCustomerId: customer } })
    const sub = fakeSubscription({ customer, priceId, userId: paying, planId: PAID_PLAN })
    await applyStripeSubscription(sub)
    expect((await getEffectivePlan(paying)).id).toBe(PAID_PLAN)

    vi.mocked(fake.subscriptions.retrieve).mockResolvedValueOnce({
      ...sub,
      latest_invoice: { payments: { data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_evoliia_1' } }] } },
    } as never)
    vi.mocked(fake.refunds.create).mockResolvedValueOnce({ id: 're_evoliia', amount: 3400 } as never)
    vi.mocked(fake.subscriptions.cancel).mockResolvedValueOnce({ ...sub, status: 'canceled' } as never)
    const result = await refundLastPayment(fake, paying, { cancel: true })
    expect(result).toEqual({ refundedCents: 3400, canceled: true })
    expect(fake.refunds.create).toHaveBeenLastCalledWith({ payment_intent: 'pi_evoliia_1', metadata: { userId: paying } })
    expect(fake.subscriptions.cancel).toHaveBeenCalledWith(sub.id)
    expect((await getSubscriptionView(paying)).status).toBe('FREE')
    await expect(refundLastPayment(fake, paying, { cancel: true })).rejects.toMatchObject({ code: 'VALIDATION' })
    await prisma.user.delete({ where: { id: paying } })
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

describe('Recharges de crédits', () => {
  const PACK = DEFAULT_CREDIT_PACKS.find((pack) => pack.id === 'pack-500')!
  let acheteur: string

  beforeAll(async () => {
    acheteur = await creerCreateur(null)
    await getWallet(acheteur)
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: acheteur } }).catch(() => undefined)
  })

  /** Une session de paiement terminée, telle que le webhook la livrerait. */
  function sessionPayee(params: {
    paiement: string
    montant?: number
    statut?: Stripe.Checkout.Session.PaymentStatus
    credits?: number
  }): Stripe.Checkout.Session {
    return {
      id: next('cs'),
      object: 'checkout.session',
      mode: 'payment',
      payment_status: params.statut ?? 'paid',
      payment_intent: params.paiement,
      amount_total: params.montant ?? PACK.priceCents,
      client_reference_id: acheteur,
      metadata: {
        genre: 'recharge',
        userId: acheteur,
        packId: PACK.id,
        credits: String(params.credits ?? PACK.credits),
        priceCents: String(PACK.priceCents),
      },
    } as unknown as Stripe.Checkout.Session
  }

  const solde = async () => {
    const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { userId: acheteur } })
    return { balance: wallet.balance, purchased: wallet.purchased }
  }

  it('ouvre un paiement unique au prix du catalogue, sans rien créditer', async () => {
    const avant = await solde()
    const { url } = await commencerRecharge(fake, acheteur, { packId: PACK.id, locale: 'fr' })
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//)
    const params = created.sessions.at(-1)!.params
    expect(params.mode).toBe('payment')
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(PACK.priceCents)
    expect(params.metadata).toMatchObject({ genre: 'recharge', userId: acheteur, credits: String(PACK.credits) })
    expect(params.success_url).toContain('recharge=succes')
    expect(await solde()).toEqual(avant)
  })

  it('refuse un pack qui n’existe pas', async () => {
    await expect(commencerRecharge(fake, acheteur, { packId: 'pack-gratuit', locale: 'fr' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('verse les crédits sur l’événement signé, une seule fois', async () => {
    const avant = await solde()
    const paiement = `pi_${randomUUID()}`
    const livraison = event('checkout.session.completed', sessionPayee({ paiement }))
    expect(await handleStripeEvent(fake, livraison)).toBe('handled')
    expect(await solde()).toEqual({ balance: avant.balance + PACK.credits, purchased: avant.purchased + PACK.credits })

    // Même livraison rejouée, puis même paiement sous un autre événement : rien de plus.
    expect(await handleStripeEvent(fake, livraison)).toBe('duplicate')
    expect(await handleStripeEvent(fake, event('checkout.session.async_payment_succeeded', sessionPayee({ paiement })))).toBe(
      'duplicate',
    )
    expect((await solde()).balance).toBe(avant.balance + PACK.credits)
    const lignes = await prisma.creditLedger.findMany({ where: { stripePaymentId: paiement } })
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ type: 'CREDIT_PURCHASE', delta: PACK.credits })
  })

  it('ne verse rien pour un paiement en attente ou un montant qui n’est pas celui demandé', async () => {
    const avant = await solde()
    const attente = sessionPayee({ paiement: `pi_${randomUUID()}`, statut: 'unpaid' })
    expect(await handleStripeEvent(fake, event('checkout.session.completed', attente))).toBe('ignored')
    const rabais = sessionPayee({ paiement: `pi_${randomUUID()}`, montant: 100 })
    expect(await handleStripeEvent(fake, event('checkout.session.completed', rabais))).toBe('ignored')
    expect(await solde()).toEqual(avant)

    // Le virement arrive : c'est cet événement-là qui verse.
    const paye = { ...attente, payment_status: 'paid' } as Stripe.Checkout.Session
    expect(await handleStripeEvent(fake, event('checkout.session.async_payment_succeeded', paye))).toBe('handled')
    expect((await solde()).balance).toBe(avant.balance + PACK.credits)
  })

  it('garde les crédits achetés au renouvellement mensuel', async () => {
    const avant = await solde()
    expect(avant.purchased).toBeGreaterThan(0)
    await prisma.creditWallet.update({ where: { userId: acheteur }, data: { resetsAt: new Date(Date.now() - 1000) } })
    const apres = await getWallet(acheteur)
    expect(apres.purchased).toBe(avant.purchased)
    expect(apres.balance).toBe(apres.monthlyGrant + avant.purchased)
  })

  it('reprend au remboursement les crédits achetés qui restent, et rien de la réserve mensuelle', async () => {
    const paiement = `pi_${randomUUID()}`
    await handleStripeEvent(fake, event('checkout.session.completed', sessionPayee({ paiement })))
    const avant = await solde()

    const charge = { id: next('ch'), object: 'charge', payment_intent: paiement, refunded: true, amount_refunded: PACK.priceCents }
    // Un remboursement partiel ne reprend rien : c'est un geste à trancher à la main.
    expect(
      await handleStripeEvent(fake, event('charge.refunded', { ...charge, refunded: false, amount_refunded: 100 })),
    ).toBe('ignored')
    expect(await solde()).toEqual(avant)

    expect(await handleStripeEvent(fake, event('charge.refunded', charge))).toBe('handled')
    expect(await solde()).toEqual({ balance: avant.balance - PACK.credits, purchased: avant.purchased - PACK.credits })
    expect(await handleStripeEvent(fake, event('charge.refunded', charge))).toBe('duplicate')
    expect((await solde()).balance).toBe(avant.balance - PACK.credits)
  })

  it('dépense d’abord la réserve mensuelle, puis les crédits achetés', async () => {
    const avant = await solde()
    const mensuel = avant.balance - avant.purchased
    await spendCredits(acheteur, mensuel + 10, 'test:depense')
    expect(await solde()).toEqual({ balance: avant.purchased - 10, purchased: avant.purchased - 10 })
  })

  it('reprend un événement dont le traitement a échoué à la livraison suivante', async () => {
    const session = { id: next('cs'), object: 'checkout.session', mode: 'subscription', subscription: next('sub') }
    const livraison = event('checkout.session.completed', session)
    vi.mocked(fake.subscriptions.retrieve).mockRejectedValueOnce(new Error('Stripe injoignable'))
    await expect(handleStripeEvent(fake, livraison)).rejects.toThrow('Stripe injoignable')
    // L'échec n'a pas marqué l'événement comme vu : la livraison suivante le traite.
    expect(await prisma.stripeEvent.findUnique({ where: { id: livraison.id } })).toBeNull()

    vi.mocked(fake.subscriptions.retrieve).mockResolvedValueOnce(
      fakeSubscription({ customer: `cus_${randomUUID()}`, priceId: 'price_inconnu', userId: acheteur, planId: FREE_PLAN_ID, status: 'incomplete' }) as never,
    )
    expect(await handleStripeEvent(fake, livraison)).toBe('handled')
    expect(await handleStripeEvent(fake, livraison)).toBe('duplicate')
  })
})

describe('Stripe Connect — le créateur encaisse ses clients', () => {
  it('ouvre un compte connecté une seule fois et garde l’inscription en attente', async () => {
    const url = await startStripeOnboarding(fake, creator, 'fr')
    expect(url).toContain('connect.stripe.test')
    expect(created.accounts).toBe(1)
    // Un compte avec tableau de bord complet, dont les frais et les pertes sont à la
    // charge de son titulaire : jamais de la plateforme.
    expect(created.accountParams).toMatchObject({
      dashboard: 'full',
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
    })

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
      payment_intent: 'pi_vente_1',
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

  it('rembourse un paiement unique depuis Evoliia, commission comprise', async () => {
    const before = await listSales(creator, projectId)
    const sale = before.purchases.find((row) => row.mode === 'payment')!
    expect(sale.refundable).toBe(true)

    // Un voisin ne rembourse pas ce qui n'est pas à lui.
    await expect(refundPurchase(fake, neighbour, projectId, sale.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(refundPurchase(fake, creator, projectId, sale.id, { amountCents: 99_999 })).rejects.toMatchObject({
      code: 'VALIDATION',
    })

    const partial = await refundPurchase(fake, creator, projectId, sale.id, { amountCents: 500 })
    expect(partial).toMatchObject({ status: 'paid', refundedCents: 500, refundable: true })
    const full = await refundPurchase(fake, creator, projectId, sale.id)
    expect(full).toMatchObject({ status: 'refunded', refundedCents: 1500, refundable: false })
    expect(created.refunds.slice(-2)).toEqual([
      { payment_intent: 'pi_vente_1', amount: 500, refund_application_fee: true, metadata: { projectId, purchaseId: sale.id } },
      { payment_intent: 'pi_vente_1', amount: 1000, refund_application_fee: true, metadata: { projectId, purchaseId: sale.id } },
    ])
    await expect(refundPurchase(fake, creator, projectId, sale.id)).rejects.toMatchObject({ code: 'VALIDATION' })

    const after = await listSales(creator, projectId)
    expect(after.totals.refundedCents).toBe(1500)
    expect(after.totals.amountCents).toBe(before.totals.amountCents - 1500)
  })

  it('rapatrie un remboursement fait depuis le tableau de bord Stripe du créateur', async () => {
    const endUser = { id: endUserId, email: 'client@exemple.test', displayName: null }
    await startAppCheckout(fake, runtime(creator, projectId), endUser, 'pack')
    const last = created.sessions.at(-1)!
    const session = {
      id: 'cs_vente_3',
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      amount_total: 1500,
      currency: 'eur',
      subscription: null,
      payment_intent: 'pi_vente_3',
      metadata: last.params.metadata,
    }
    await handleConnectEvent(fake, event('checkout.session.completed', session, 'acct_test_1'))

    const charge = {
      id: 'ch_3',
      object: 'charge',
      amount: 1500,
      amount_refunded: 1500,
      refunded: true,
      payment_intent: 'pi_vente_3',
      customer: null,
      metadata: last.params.metadata,
    }
    expect(await handleConnectEvent(fake, event('charge.refunded', charge, 'acct_autre'))).toBe('ignored')
    expect(await handleConnectEvent(fake, event('charge.refunded', charge, 'acct_test_1'))).toBe('handled')
    const sales = await listSales(creator, projectId)
    expect(sales.purchases.find((row) => row.email !== null && row.status === 'refunded' && row.refundedCents === 1500)).toBeDefined()
    expect(sales.purchases.filter((row) => row.status === 'refunded')).toHaveLength(2)
  })

  it('ne montre les ventes qu’au créateur de l’application', async () => {
    await expect(listSales(neighbour, projectId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const hidden = await withRuntimeScope(randomUUID(), (tx) => tx.appPurchase.count())
    expect(hidden).toBe(0)
  })
})
