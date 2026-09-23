/**
 * Les sources de ventes que Nova sait lire.
 *
 * Une seule fait référence à la fois, dans cet ordre : la boutique Shopify, sinon la boutique
 * WooCommerce, sinon les encaissements Stripe, sinon les transactions gagnées du CRM. Elles ne s'additionnent jamais — une boutique
 * qui encaisse par Stripe verrait chaque vente comptée deux fois, et rien dans les données ne
 * permet de reconnaître les doublons.
 */
export type SourceVentes = 'shopify' | 'woocommerce' | 'stripe' | 'hubspot'

export const ORDRE_SOURCES: readonly SourceVentes[] = ['shopify', 'woocommerce', 'stripe', 'hubspot']

export const NOM_SOURCE: Record<SourceVentes, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  stripe: 'Stripe',
  hubspot: 'HubSpot',
}

/** L'identifiant du fournisseur dans le catalogue des connexions. */
export const FOURNISSEUR_SOURCE: Record<SourceVentes, string> = {
  shopify: 'shopify',
  woocommerce: 'woocommerce',
  stripe: 'stripe-revenus',
  hubspot: 'hubspot',
}
