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

export type StripeMode = 'live' | 'test'

/**
 * Le mode de la clé configurée. Stripe sépare strictement les deux mondes : un tarif, un
 * client ou un compte créé en mode test n'existe pas en production. Tout identifiant que
 * l'on garde en base est donc lu à la lumière du mode courant, et recréé quand il vient de
 * l'autre — c'est ce qui rend le passage en production indolore.
 */
export function stripeMode(): StripeMode {
  return env.stripeSecretKey?.startsWith('sk_live') === true ? 'live' : 'test'
}

/** Stripe ne connaît pas cet identifiant : il vient de l'autre mode, ou a été supprimé. */
export function isStripeMissing(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeError && error.code === 'resource_missing'
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
    // Un compte connecté inconnu vient presque toujours de l'autre mode (test ↔ production) :
    // le dire évite de chercher une panne là où il n'y a qu'une reconnexion à faire.
    const hint =
      error.code === 'resource_missing' && /account/i.test(error.message)
        ? ' Le compte Stripe relié ne vaut pas dans ce mode : déconnectez puis reconnectez Stripe depuis Connexions.'
        : ''
    return new AppError('UNSUPPORTED_REQUEST', `Stripe a répondu : ${error.message}${hint}`)
  }
  return error
}

export type { Stripe }
