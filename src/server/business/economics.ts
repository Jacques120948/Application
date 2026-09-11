/**
 * Arithmétique commerciale du parcours.
 *
 * Tout ce qui touche à l'argent est calculé **ici, de façon déterministe**, jamais par le
 * modèle de langage. Deux raisons :
 *   - un chiffre inventé par une IA sur un sujet financier est inacceptable ;
 *   - la formulation doit rester sous notre contrôle. La plateforme parle toujours de
 *     chiffre d'affaires théorique avant frais et taxes, jamais de revenu garanti.
 *
 * Règle de vocabulaire appliquée partout : « représenterait », jamais « rapportera ».
 */

export type PriceInterval = 'once' | 'month' | 'year'

export const OBJECTIVE_PRESETS_CENTS = [30_000, 50_000, 100_000, 200_000] as const

/**
 * Chiffre d'affaires mensuel qu'apporte un client, selon le rythme de paiement.
 * Pour un achat unique, il faut de nouveaux clients chaque mois : le prix compte
 * intégralement, mais l'unité de mesure devient « clients par mois ».
 */
export function monthlyRevenuePerCustomerCents(
  priceCents: number,
  interval: PriceInterval,
): number {
  if (priceCents <= 0) return 0
  switch (interval) {
    case 'month':
      return priceCents
    case 'year':
      return Math.round(priceCents / 12)
    case 'once':
      return priceCents
  }
}

/** Nombre de clients payants correspondant à l'objectif. `null` si l'offre est gratuite. */
export function customersNeededFor(
  monthlyGoalCents: number,
  priceCents: number,
  interval: PriceInterval,
): number | null {
  const perCustomer = monthlyRevenuePerCustomerCents(priceCents, interval)
  if (perCustomer <= 0 || monthlyGoalCents <= 0) return null
  return Math.max(1, Math.ceil(monthlyGoalCents / perCustomer))
}

export function formatAmount(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

const INTERVAL_LABEL: Record<PriceInterval, string> = {
  once: 'paiement unique',
  month: 'par mois',
  year: 'par an',
}

export function formatPrice(cents: number, interval: PriceInterval, currency = 'EUR'): string {
  if (cents <= 0) return 'Gratuit'
  return interval === 'once'
    ? `${formatAmount(cents, currency)} (${INTERVAL_LABEL.once})`
    : `${formatAmount(cents, currency)} ${INTERVAL_LABEL[interval]}`
}

/**
 * Phrase affichée à l'utilisateur sous chaque idée.
 * Volontairement au conditionnel, et frais et taxes explicitement exclus.
 */
export function describeObjective(params: {
  monthlyGoalCents: number
  priceCents: number
  interval: PriceInterval
  currency?: string
}): string {
  const currency = params.currency ?? 'EUR'
  const customers = customersNeededFor(params.monthlyGoalCents, params.priceCents, params.interval)

  if (customers === null) {
    return "Cette idée est gratuite pour vos utilisateurs : elle ne génère pas directement de chiffre d'affaires."
  }

  const goal = formatAmount(params.monthlyGoalCents, currency)
  const price = formatAmount(params.priceCents, currency)

  if (params.interval === 'once') {
    return `À ${price} l'achat, environ ${customers} client(s) par mois représenteraient ${goal} de chiffre d'affaires mensuel, avant frais et taxes.`
  }
  if (params.interval === 'year') {
    return `Avec un abonnement à ${price} par an, environ ${customers} abonné(s) représenteraient ${goal} de chiffre d'affaires mensuel, avant frais et taxes.`
  }
  return `Avec un abonnement à ${price} par mois, environ ${customers} abonné(s) représenteraient ${goal} de chiffre d'affaires mensuel, avant frais et taxes.`
}

/** Avertissement affiché partout où un objectif est montré. Jamais omis. */
export const OBJECTIVE_DISCLAIMER =
  "Cet objectif sert uniquement à orienter votre projet. Ce n'est ni une prévision, ni une promesse de revenu."
