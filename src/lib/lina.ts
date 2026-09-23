/**
 * Ce que les écrans de Lina partagent avec le serveur : d'où viennent les clients, comment
 * on nomme un client sans le nommer, où sa fiche se lit. Pur, sans dépendance.
 */

export type SourceLina = 'shopify' | 'woocommerce' | 'stripe'

export const NOM_SOURCE_LINA: Record<SourceLina, string> = { shopify: 'Shopify', woocommerce: 'WooCommerce', stripe: 'Stripe' }

/** Le lien vers la fiche du client dans l'outil où son nom se lit. `null` quand il n'y en a pas. */
export function lienFiche(source: SourceLina | null, boutique: string, ref: string): { href: string; libelle: string } | null {
  if (source === 'shopify' && boutique !== '') return { href: `https://${boutique}/admin/customers/${encodeURIComponent(ref)}`, libelle: 'Ouvrir dans Shopify ↗' }
  if (source === 'woocommerce' && boutique !== '' && /^c\d+$/u.test(ref)) {
    return { href: `${boutique}/wp-admin/user-edit.php?user_id=${ref.slice(1)}`, libelle: 'Ouvrir dans WordPress ↗' }
  }
  if (source === 'stripe' && /^cus_[A-Za-z0-9]+$/u.test(ref)) return { href: `https://dashboard.stripe.com/customers/${ref}`, libelle: 'Ouvrir dans Stripe ↗' }
  return null
}

/** Le numéro d'un client, tel qu'on l'affiche : un achat sans compte n'a qu'une empreinte. */
export function numeroClient(source: SourceLina | null, ref: string): string {
  if (source === 'woocommerce') return ref.startsWith('g') ? `Achat sans compte ${ref.slice(1, 7)}…` : `Client n° ${ref.slice(1)}`
  return `Client n° ${ref}`
}

/** « 24 août » : une semaine se lit par son lundi, sans l'année. */
export function semaineLisible(lundi: string): string {
  return new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${lundi}T00:00:00Z`))
}
