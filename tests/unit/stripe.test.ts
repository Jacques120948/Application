import { describe, expect, it } from 'vitest'
import {
  montantPour,
  priceFingerprint,
  remiseAnnuelle,
  statusFromStripe,
} from '@/server/billing/stripe/subscriptions'
import { findProvider } from '@/server/integrations/catalog'
import { countryCodeOf } from '@/server/integrations/providers/stripe'

/**
 * Ce qui, dans l'intégration Stripe, se vérifie sans base ni réseau.
 */
describe('Stripe — correspondances', () => {
  it('change de tarif Stripe dès que le prix, la devise ou le rythme change', () => {
    const base = { priceCents: 1900, priceYearCents: 0, currency: 'EUR', interval: 'month' }
    expect(priceFingerprint(base)).toBe('test:1900:eur:month')
    // Le mode fait partie de l'empreinte : le passage en production recrée les tarifs.
    expect(priceFingerprint(base, 'mois', 'live')).toBe('live:1900:eur:month')
    expect(priceFingerprint({ ...base, priceCents: 2900 })).not.toBe(priceFingerprint(base))
    expect(priceFingerprint({ ...base, currency: 'CHF' })).not.toBe(priceFingerprint(base))
    expect(priceFingerprint({ ...base, interval: 'year' })).not.toBe(priceFingerprint(base))
    // La casse de la devise ne compte pas : « EUR » et « eur » sont le même tarif.
    expect(priceFingerprint({ ...base, currency: 'eur' })).toBe(priceFingerprint(base))
  })

  /**
   * Mensuel et annuel sont deux tarifs distincts chez Stripe, donc deux empreintes
   * distinctes. Les confondre ferait payer douze fois le prix d'un mois à quelqu'un qui a
   * choisi le mois — ou un douzième de l'année à quelqu'un qui a choisi l'année.
   */
  it('ne confond jamais le tarif mensuel et le tarif annuel', () => {
    const plan = { priceCents: 4900, priceYearCents: 47_000, currency: 'CHF', interval: 'month' }
    expect(priceFingerprint(plan, 'mois')).toBe('test:4900:chf:month')
    expect(priceFingerprint(plan, 'an')).toBe('test:47000:chf:year')
    expect(priceFingerprint(plan, 'an')).not.toBe(priceFingerprint(plan, 'mois'))
  })

  /**
   * La remise se déduit des deux prix, elle ne se saisit pas : un taux réglé à part
   * finirait par contredire les prix qu'il prétend décrire, et c'est un écart qu'un client
   * repère en une multiplication.
   */
  it('déduit la remise annuelle des deux prix, arrondie vers le bas', () => {
    // 49 × 12 = 588. À 470, l'économie est de 118, soit 20,06 % → 20 %.
    expect(remiseAnnuelle({ priceCents: 4900, priceYearCents: 47_000 })).toBe(20)
    // 19 × 12 = 228. À 190 (dix mois), l'économie est de 38, soit 16,66 % → 16 %.
    expect(remiseAnnuelle({ priceCents: 1900, priceYearCents: 19_000 })).toBe(16)
  })

  it('n’annonce aucune remise là où il n’y en a pas', () => {
    // Pas de tarif annuel du tout.
    expect(remiseAnnuelle({ priceCents: 4900, priceYearCents: 0 })).toBeNull()
    // Un tarif annuel plus cher que douze mois : ce n'est pas une remise, on se tait.
    expect(remiseAnnuelle({ priceCents: 4900, priceYearCents: 60_000 })).toBeNull()
    // Exactement douze mois : rien à annoncer non plus.
    expect(remiseAnnuelle({ priceCents: 4900, priceYearCents: 58_800 })).toBeNull()
    // L'offre gratuite ne se prend pas à l'année.
    expect(remiseAnnuelle({ priceCents: 0, priceYearCents: 0 })).toBeNull()
  })

  it('rend le bon montant selon le rythme', () => {
    const plan = { priceCents: 4900, priceYearCents: 47_000 }
    expect(montantPour(plan, 'mois')).toBe(4900)
    expect(montantPour(plan, 'an')).toBe(47_000)
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
