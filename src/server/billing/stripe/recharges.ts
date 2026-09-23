import type Stripe from 'stripe'
import { z } from 'zod'
import { env } from '@/lib/env'
import { AppError, notFound } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { crediterAchat, getWallet, portefeuilleVerrouille, reprendreAchat } from '@/server/billing/credits'
import { creditPacks } from '@/server/billing/packs'
import { ensureStripeCustomer } from './subscriptions'

/**
 * Les recharges de crédits, payées une fois.
 *
 * Trois règles, et ce sont celles qui valent pour tout ce qui touche aux crédits.
 *
 * **Le serveur décide de tout.** Le navigateur n'envoie qu'un identifiant de pack. Le
 * prix, la devise et le nombre de crédits sont lus dans le catalogue, ici, et écrits par le
 * serveur dans la session de paiement. Rien de ce qu'un navigateur annonce n'entre dans le
 * calcul.
 *
 * **Les crédits arrivent par le webhook, jamais par le retour du navigateur.** La page de
 * retour dit « paiement reçu, vos crédits arrivent » ; c'est l'événement signé par Stripe,
 * vérifié côté serveur, qui les verse. Quelqu'un qui fabrique une adresse de retour ne
 * reçoit rien.
 *
 * **Un paiement ne crédite qu'une fois.** Le grand livre porte l'identifiant du paiement,
 * et cette colonne est unique en base : un événement livré deux fois, ou rejoué, se heurte
 * à la contrainte et ne verse rien de plus. C'est la base de données qui le garantit, pas
 * une vérification qu'une course pourrait doubler.
 */

/** Ce qui distingue une recharge d'un abonnement dans les métadonnées de la session. */
const GENRE = 'recharge'

export const rechargeInput = z.object({
  packId: z.string().trim().min(1).max(48),
  locale: z.string().max(8).default('fr'),
})

function urls(locale: string): { success: string; cancel: string } {
  const base = `${env.appUrl.replace(/\/$/, '')}/${locale}/abonnement`
  return {
    success: `${base}?recharge=succes#recharges`,
    cancel: `${base}?recharge=annulee#recharges`,
  }
}

function langueStripe(locale: string): Stripe.Checkout.SessionCreateParams.Locale {
  return locale === 'de' ? 'de' : locale === 'it' ? 'it' : locale === 'es' ? 'es' : locale === 'en' ? 'en' : 'fr'
}

/** Commence le paiement d'une recharge. Rend l'adresse de la page Stripe. */
export async function commencerRecharge(
  stripe: Stripe,
  userId: string,
  entree: z.infer<typeof rechargeInput>,
): Promise<{ url: string }> {
  const pack = (await creditPacks()).find((un) => un.id === entree.packId)
  if (pack === undefined) throw notFound('Cette recharge n’existe pas.')

  const customerId = await ensureStripeCustomer(stripe, userId)
  const { success, cancel } = urls(entree.locale)
  const metadata = {
    genre: GENRE,
    userId,
    packId: pack.id,
    // Écrits par le serveur, lus par le webhook : le navigateur ne les voit jamais passer.
    credits: String(pack.credits),
    priceCents: String(pack.priceCents),
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    client_reference_id: userId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pack.currency.toLowerCase(),
          unit_amount: pack.priceCents,
          product_data: {
            name: `Recharge de ${pack.credits} crédits Evoliia`,
            description: 'Des crédits qui n’expirent pas, en plus de votre réserve mensuelle.',
          },
        },
      },
    ],
    success_url: success,
    cancel_url: cancel,
    locale: langueStripe(entree.locale),
    metadata,
    payment_intent_data: { metadata },
  })
  if (session.url === null) throw new AppError('INTERNAL', "Stripe n'a pas renvoyé de page de paiement.")
  logger.info('stripe : recharge commencée', { userId, packId: pack.id })
  return { url: session.url }
}

/** L'identifiant du paiement d'une session, qui sert de clé d'unicité au crédit. */
function paiementDe(session: Stripe.Checkout.Session): string | null {
  const ref = session.payment_intent
  if (ref === null) return null
  return typeof ref === 'string' ? ref : ref.id
}

/**
 * Verse les crédits d'une recharge payée. Appelée par le webhook, et par lui seul.
 *
 * Rend `ignored` quand la session n'est pas une recharge, ou pas encore payée — un
 * virement en attente, par exemple : il sera versé à l'événement qui confirme le paiement.
 */
export async function verserRecharge(
  session: Stripe.Checkout.Session,
): Promise<'handled' | 'duplicate' | 'ignored'> {
  if (session.mode !== 'payment' || session.metadata?.genre !== GENRE) return 'ignored'
  if (session.payment_status !== 'paid') return 'ignored'

  const userId = session.metadata.userId ?? session.client_reference_id ?? null
  const credits = Number(session.metadata.credits)
  const attendu = Number(session.metadata.priceCents)
  const paiement = paiementDe(session)
  if (userId === null || paiement === null || !Number.isInteger(credits) || credits <= 0) {
    logger.warn('stripe : recharge illisible', { sessionId: session.id })
    return 'ignored'
  }
  /*
   * Le montant encaissé doit être celui que le serveur a demandé. Un écart — un code
   * promotionnel, une session modifiée — ne verse rien et se signale : on ne crédite pas au
   * prix plein ce qui a été payé autrement.
   */
  if (session.amount_total !== attendu) {
    logger.warn('stripe : recharge au montant inattendu, non versée', {
      sessionId: session.id,
      attendu,
      encaisse: session.amount_total,
    })
    return 'ignored'
  }

  // Le portefeuille doit exister et être à jour avant d'y ajouter quoi que ce soit.
  await getWallet(userId)

  try {
    await prisma.$transaction(async (tx) => {
      const wallet = await portefeuilleVerrouille(tx, userId)
      const apres = crediterAchat(wallet, credits)
      await tx.creditWallet.update({
        where: { userId },
        data: { balance: apres.balance, purchased: apres.purchased },
      })
      await tx.creditLedger.create({
        data: {
          userId,
          delta: credits,
          balanceAfter: apres.balance,
          reason: `achat:${session.metadata?.packId ?? 'recharge'}`,
          type: 'CREDIT_PURCHASE',
          stripePaymentId: paiement,
        },
      })
    })
  } catch (error) {
    // La contrainte d'unicité sur le paiement : déjà versé, rien à faire de plus.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return 'duplicate'
    }
    throw error
  }

  logger.info('stripe : recharge versée', { userId, credits })
  return 'handled'
}

/**
 * Reprend les crédits d'une recharge remboursée — ceux qui restent, jamais plus.
 *
 * Ce qui a déjà été consommé ne se reprend pas : on ne ferait que passer le solde en
 * négatif, ou prendre sur la dotation mensuelle, qui n'a rien à voir avec l'achat.
 */
export async function reprendreRecharge(charge: Stripe.Charge): Promise<'handled' | 'duplicate' | 'ignored'> {
  const ref = charge.payment_intent
  const paiement = ref === null ? null : typeof ref === 'string' ? ref : ref.id
  if (paiement === null) return 'ignored'

  const achat = await prisma.creditLedger.findUnique({
    where: { stripePaymentId: paiement },
    select: { userId: true, delta: true, type: true },
  })
  if (achat === null || achat.type !== 'CREDIT_PURCHASE') return 'ignored'
  // Remboursement total seulement : un remboursement partiel est un geste à trancher à la main.
  if (!charge.refunded) {
    logger.warn('stripe : remboursement partiel d’une recharge, crédits laissés', { userId: achat.userId })
    return 'ignored'
  }

  try {
    await prisma.$transaction(async (tx) => {
      const wallet = await portefeuilleVerrouille(tx, achat.userId)
      const apres = reprendreAchat(wallet, achat.delta)
      await tx.creditWallet.update({
        where: { userId: achat.userId },
        data: { balance: apres.balance, purchased: apres.purchased },
      })
      await tx.creditLedger.create({
        data: {
          userId: achat.userId,
          delta: -apres.repris,
          balanceAfter: apres.balance,
          reason: 'remboursement:recharge',
          type: 'REFUND',
          stripePaymentId: `remboursement:${paiement}`,
        },
      })
    })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return 'duplicate'
    }
    throw error
  }
  logger.info('stripe : recharge remboursée', { userId: achat.userId })
  return 'handled'
}
