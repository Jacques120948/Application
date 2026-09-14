import { describe, expect, it } from 'vitest'
import { priceFingerprint, statusFromStripe } from '@/server/billing/stripe/subscriptions'
import { findProvider } from '@/server/integrations/catalog'
import { countryCodeOf } from '@/server/integrations/providers/stripe'

/**
 * Ce qui, dans l'intégration Stripe, se vérifie sans base ni réseau.
 */
describe('Stripe — correspondances', () => {
  it('change de tarif Stripe dès que le prix, la devise ou le rythme change', () => {
    const base = { priceCents: 1900, currency: 'EUR', interval: 'month' }
    expect(priceFingerprint(base)).toBe('1900:eur:month')
    expect(priceFingerprint({ ...base, priceCents: 2900 })).not.toBe(priceFingerprint(base))
    expect(priceFingerprint({ ...base, currency: 'CHF' })).not.toBe(priceFingerprint(base))
    expect(priceFingerprint({ ...base, interval: 'year' })).not.toBe(priceFingerprint(base))
    // La casse de la devise ne compte pas : « EUR » et « eur » sont le même tarif.
    expect(priceFingerprint({ ...base, currency: 'eur' })).toBe(priceFingerprint(base))
  })

  it('traduit les statuts Stripe sans jamais ouvrir une offre non payée', () => {
    expect(statusFromStripe('active')).toBe('ACTIVE')
    expect(statusFromStripe('trialing')).toBe('TRIALING')
    expect(statusFromStripe('past_due')).toBe('PAST_DUE')
    expect(statusFromStripe('unpaid')).toBe('PAST_DUE')
    // Un paiement pas encore abouti n'ouvre rien : on attend Stripe.
    expect(statusFromStripe('incomplete')).toBe('PENDING')
    expect(statusFromStripe('canceled')).toBe('CANCELED')
    expect(statusFromStripe('incomplete_expired')).toBe('CANCELED')
  })

  it('déclare Stripe sans coût pour Evoliia et à la charge du créateur', () => {
    const stripe = findProvider('stripe')
    expect(stripe?.status).toBe('available')
    expect(stripe?.costToEvoliia).toBe('aucun')
    expect(stripe?.connectionTarget).toBe('APP')
    expect(stripe?.credential).toBe('OAUTH')
  })

  it('déduit le pays du compte Stripe du profil, avec la Suisse par défaut', () => {
    expect(countryCodeOf('Suisse')).toBe('ch')
    expect(countryCodeOf(' France ')).toBe('fr')
    expect(countryCodeOf('Belgique')).toBe('be')
    expect(countryCodeOf('de')).toBe('de')
    expect(countryCodeOf('Atlantide')).toBe('ch')
    expect(countryCodeOf(null)).toBe('ch')
  })
})
