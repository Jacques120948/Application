/**
 * Couche d'abstraction des paiements (exigence 12).
 *
 * Le point important : on ne peut pas supposer que Stripe est utilisable pour tous les
 * achats d'une application mobile. Les règles d'Apple et de Google imposent, dans de
 * nombreux cas, leur propre système d'achat intégré. La distinction est donc posée dès
 * maintenant dans les types, pour que l'ajout des achats intégrés en phase 3 ne demande
 * pas de réécrire la monétisation.
 *
 * ÉTAT : aucune intégration n'est active en V1. `resolveProvider` décrit ce qui sera
 * utilisé ; `createCheckout` n'existe pas encore et l'interface l'indique clairement.
 */

export type Platform = 'web' | 'ios' | 'android'

export type MonetizationModel =
  | 'free'
  | 'one_time'
  | 'subscription'
  | 'freemium'
  | 'credits'

export type PaymentProvider = 'stripe' | 'apple_iap' | 'google_play_billing' | 'none'

export type ProviderDecision = {
  provider: PaymentProvider
  /** Explication destinée au créateur, en langage simple. */
  rationale: string
  /** Vrai lorsque l'intégration est réellement disponible aujourd'hui. */
  available: boolean
}

/**
 * Détermine le moyen de paiement applicable à une plateforme donnée.
 *
 * Règle retenue, volontairement conservatrice : tout contenu numérique consommé dans une
 * application mobile passe par l'achat intégré de la plateforme ; le web passe par Stripe.
 * Les exceptions (biens physiques, services hors application, programmes spécifiques)
 * relèvent de règles qui évoluent et sont traitées au cas par cas en phase 3.
 */
export function resolveProvider(
  platform: Platform,
  model: MonetizationModel,
): ProviderDecision {
  if (model === 'free') {
    return { provider: 'none', rationale: 'Application gratuite : aucun paiement.', available: true }
  }
  if (platform === 'web') {
    return {
      provider: 'stripe',
      rationale: 'Sur le web, les paiements passent par Stripe.',
      available: false,
    }
  }
  if (platform === 'ios') {
    return {
      provider: 'apple_iap',
      rationale:
        "Sur iPhone, les contenus numériques doivent passer par l'achat intégré d'Apple.",
      available: false,
    }
  }
  return {
    provider: 'google_play_billing',
    rationale:
      "Sur Android, les contenus numériques doivent passer par le système de facturation de Google Play.",
    available: false,
  }
}
