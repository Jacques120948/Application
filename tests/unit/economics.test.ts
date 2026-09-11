import { describe, expect, it } from 'vitest'
import {
  customersNeededFor,
  describeObjective,
  formatPrice,
  monthlyRevenuePerCustomerCents,
} from '@/server/business/economics'

describe('arithmétique commerciale', () => {
  it('calcule le nombre d’abonnés mensuels nécessaires', () => {
    // 1 000 € visés, 19 € par mois -> 53 abonnés (exemple du cahier des charges).
    expect(customersNeededFor(100_000, 1_900, 'month')).toBe(53)
  })

  it('ramène un abonnement annuel à sa contribution mensuelle', () => {
    expect(monthlyRevenuePerCustomerCents(12_000, 'year')).toBe(1_000)
    expect(customersNeededFor(100_000, 12_000, 'year')).toBe(100)
  })

  it('traite un achat unique comme des clients à trouver chaque mois', () => {
    expect(customersNeededFor(50_000, 2_500, 'once')).toBe(20)
  })

  it('ne renvoie aucun nombre de clients pour une offre gratuite', () => {
    expect(customersNeededFor(100_000, 0, 'month')).toBeNull()
  })

  it('arrondit toujours au client supérieur', () => {
    expect(customersNeededFor(10_000, 3_000, 'month')).toBe(4)
  })

  it('formule au conditionnel et exclut frais et taxes', () => {
    const sentence = describeObjective({
      monthlyGoalCents: 100_000,
      priceCents: 1_900,
      interval: 'month',
    })
    expect(sentence).toContain('53')
    expect(sentence).toContain('représenteraient')
    expect(sentence).toContain('avant frais et taxes')
    // Aucune promesse de gain.
    expect(sentence).not.toMatch(/gagner|rapporter|vous gagnerez/i)
  })

  it('le dit franchement quand l’idée ne rapporte rien directement', () => {
    const sentence = describeObjective({
      monthlyGoalCents: 100_000,
      priceCents: 0,
      interval: 'month',
    })
    expect(sentence).toContain('ne génère pas directement')
  })

  it('formate les prix pour un lecteur non technique', () => {
    // Intl insère une espace insécable avant le symbole monétaire : on la normalise.
    const plain = (value: string) => value.replace(/\s/g, ' ')
    expect(plain(formatPrice(1_900, 'month'))).toBe('19 € par mois')
    expect(formatPrice(0, 'month')).toBe('Gratuit')
    expect(plain(formatPrice(4_900, 'once'))).toBe('49 € (paiement unique)')
  })
})
