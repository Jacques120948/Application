/** Formes partagées entre la liste d'idées et la fiche d'étude. */

export type Level = 'faible' | 'moyen' | 'fort'

export type Validation = {
  opportunityScore: number
  marketSize: string
  problemAssessment: string
  audienceAssessment: string
  competitors: Array<{ name: string; note: string }>
  essentialFeatures: string[]
  featuresToAvoid: string[]
  pricingRationale: string
  acquisitionDifficulty: Level
  acquisitionChannels: string[]
  risks: Array<{ risk: string; mitigation: string }>
  differentiators: string[]
  externalServices: Array<{ name: string; why: string; paid: boolean }>
  verdict: 'a-lancer' | 'a-ajuster' | 'a-eviter'
  verdictReason: string
}

export type SpecSheet = {
  appName: string
  tagline: string
  summary: string
  forWho: string
  problem: string
  mvpFeatures: Array<{ title: string; why: string }>
  postponed: Array<{ title: string; why: string }>
  screens: Array<{ name: string; purpose: string; requiresAccount: boolean }>
  roles: Array<{ name: string; canDo: string }>
  storedData: Array<{ name: string; description: string; private: boolean }>
  accountsNeeded: boolean
  paymentModel: string
  priceCents: number
  priceInterval: 'once' | 'month' | 'year'
  whatIsPaid: string
  externalServices: Array<{ name: string; why: string; paid: boolean }>
  runningCostCents: number
}

export type BoardIdea = {
  id: string
  title: string
  problem: string
  audience: string
  valueProposition: string
  features: string[]
  businessModel: string
  recommendedPriceCents: number
  priceInterval: 'once' | 'month' | 'year'
  /** Monnaie dans laquelle l'idée a été chiffrée, code ISO. Rien n'est converti. */
  currency: string
  /** Faux si l'idée a été chiffrée dans une autre monnaie que l'objectif courant. */
  comparableToObjective: boolean
  opportunityScore: number
  demandLevel: string
  competitionLevel: string
  complexityLevel: string
  operatingCostLevel: string
  timeToMarketWeeks: number
  runningCostCents: number
  customersNeeded: number
  risks: string[]
  differentiators: string[]
  status: 'PROPOSED' | 'SELECTED' | 'DISCARDED'
  objectiveSentence: string
  validation: Validation | null
  specSheet: SpecSheet | null
  projectId: string | null
}

export const MODEL_LABEL: Record<string, string> = {
  one_time: 'Achat unique',
  subscription: 'Abonnement',
  freemium: 'Gratuit puis payant',
  credits: 'Crédits',
  free: 'Gratuit',
}

/**
 * Formatage monétaire côté navigateur.
 *
 * La monnaie vient du profil du créateur ; la Suisse écrit « CHF 2'000 », la France
 * « 2 000 € ». Aucune conversion n'est faite, ici pas plus qu'ailleurs.
 */
const FORMAT_LOCALE: Record<string, string> = { EUR: 'fr-FR', CHF: 'fr-CH' }

export function formatMoney(cents: number, currency = 'EUR'): string {
  const code = currency in FORMAT_LOCALE ? currency : 'EUR'
  return new Intl.NumberFormat(FORMAT_LOCALE[code] ?? 'fr-FR', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

export function formatPrice(
  cents: number,
  interval: BoardIdea['priceInterval'],
  currency = 'EUR',
): string {
  if (cents <= 0) return 'Gratuit'
  const amount = formatMoney(cents, currency)
  if (interval === 'month') return `${amount} par mois`
  if (interval === 'year') return `${amount} par an`
  return `${amount} une fois`
}

export function scoreTone(score: number): 'positive' | 'caution' | 'critical' {
  if (score >= 70) return 'positive'
  if (score >= 45) return 'caution'
  return 'critical'
}
