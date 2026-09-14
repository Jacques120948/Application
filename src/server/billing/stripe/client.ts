import Stripe from 'stripe'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'

/**
 * Le client Stripe d'Evoliia.
 *
 * Un seul compte Stripe, celui d'Evoliia. Il sert à deux choses très différentes : encaisser
 * les abonnements Evoliia, et ouvrir des comptes connectés pour que les créateurs
 * encaissent leurs propres clients — sur leur compte, jamais sur celui d'Evoliia.
 *
 * La clé ne quitte jamais ce fichier. Les services reçoivent le client, pas la clé, ce qui
 * permet aussi de leur passer un faux client dans les tests.
 */

let cached: Stripe | null = null

export function isStripeAvailable(): boolean {
  return env.stripeSecretKey !== undefined
}

export function getStripe(): Stripe {
  const key = env.stripeSecretKey
  if (key === undefined) {
    throw new AppError('UNSUPPORTED_REQUEST', "Le paiement en ligne n'est pas activé sur cette installation.")
  }
  if (cached === null) cached = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 })
  return cached
}

/**
 * Traduit un refus de Stripe en erreur lisible par la personne. Le message de Stripe
 * est rédigé pour être montré (« complétez votre profil de plateforme ») ; il ne contient
 * ni clé ni donnée de carte. Tout autre incident reste une erreur interne, masquée.
 */
export function describeStripeError(error: unknown): unknown {
  if (error instanceof Stripe.errors.StripeError) {
    return new AppError('UNSUPPORTED_REQUEST', `Stripe a répondu : ${error.message}`)
  }
  return error
}

export type { Stripe }
