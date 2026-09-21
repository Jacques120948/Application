/**
 * Le seuil de rentabilité publicitaire, déduit de la marge.
 *
 * Isolé ici, sans aucune dépendance, parce qu'il est utilisé des deux côtés : le serveur
 * s'en sert pour rendre un verdict, et le formulaire s'en sert pour montrer en direct ce
 * qu'implique la marge qu'on est en train de saisir. Le recopier dans le composant ferait
 * exister deux définitions d'une même règle, et le jour où l'une changerait, l'écran
 * annoncerait un seuil que le verdict ne reconnaîtrait pas.
 */

/**
 * Le ROAS minimal pour que la publicité se paie, en pourcentage entier.
 *
 * Une marge de 40 % veut dire que cent francs de vente laissent quarante francs. Pour payer
 * cent francs de publicité, il faut donc vendre deux cent cinquante francs : le seuil vaut
 * cent divisé par la marge.
 *
 * `null` quand la marge n'est pas exploitable — non renseignée, négative, ou supérieure à
 * cent. Rendre un nombre quand même ferait annoncer une rentabilité à qui perd de l'argent.
 */
export function seuilRentabilite(margePourcent: number): number | null {
  if (!Number.isFinite(margePourcent)) return null
  if (margePourcent <= 0 || margePourcent > 100) return null
  return Math.round(10_000 / margePourcent)
}
