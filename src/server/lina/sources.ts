import { NOM_SOURCE_LINA, type SourceLina } from '@/lib/lina'

export { lienFiche, NOM_SOURCE_LINA, numeroClient, type SourceLina } from '@/lib/lina'

/**
 * D'où viennent les clients de Lina, et ce que chaque source permet.
 *
 * Shopify reste la source la plus riche : consentement marketing, paniers abandonnés,
 * segments à coller. WooCommerce et Stripe donnent les commandes ou les paiements, et Lina
 * dit ce qui manque plutôt que de le combler.
 */

/** Ce qu'une source ne donne pas, dit une fois. */
export const LIMITES_SOURCE: Record<SourceLina, string[]> = {
  shopify: [],
  woocommerce: [
    'WooCommerce ne donne pas le consentement marketing : vérifiez dans votre outil d’envoi qui accepte vos emails.',
    'WooCommerce ne donne pas les paniers abandonnés sans extension : ils ne sont pas comptés.',
  ],
  hubspot: [
    'Avec HubSpot, une « commande » est une affaire gagnée, et le client est le contact qui lui est associé.',
    'Le consentement marketing n’est pas lu dans HubSpot : vérifiez dans votre outil d’envoi qui accepte vos emails. Ni paniers ni produits.',
  ],
  stripe: [
    'Stripe ne donne ni le consentement marketing ni les paniers abandonnés : vérifiez dans votre outil d’envoi qui accepte vos emails.',
    'Un paiement Stripe ne dit pas quel produit a été acheté : ni réachat par produit, ni produits complémentaires.',
  ],
}

/**
 * Les textes écrits pour Shopify (où l'on crée un segment, où l'on active une automatisation),
 * redits pour une autre source. Appliqué aux campagnes, scénarios et constats préparés pour
 * Shopify : leur fond vaut partout, seul l'outil change.
 */
export function redire(texte: string, source: SourceLina): string {
  if (source === 'shopify') return texte
  return texte
    .replace(/Shopify → Marketing → Automatisations → ([^,;.]+)/gu, 'Votre outil d’envoi → automatisation « $1 »')
    .replace(/Shopify Flow(?: \([^)]*\))?/gu, 'une automatisation de votre outil d’envoi')
    .replace(/[Ss]egment Shopify/gu, 'liste dans votre outil d’envoi')
    .replace(/Email \(automatisation Shopify[^)]*\)/gu, 'Email (automatisation de votre outil d’envoi)')
    .replace(/dans Shopify/gu, 'dans votre outil d’envoi')
    .replace(/Shopify/gu, NOM_SOURCE_LINA[source])
}
