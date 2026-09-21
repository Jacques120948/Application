/**
 * La langue portée par le chemin d'une adresse, ou `null`.
 *
 * Conventionnellement, un site multilingue préfixe ses chemins du code de la langue —
 * `/it/bougies`, `/de/kerzen`. Deux lettres minuscules en tête de chemin, et rien d'autre :
 * un segment plus long serait une page ordinaire, et s'y fier ferait passer `/fr-CH/` ou
 * `/produits/` pour des langues.
 *
 * Ce fichier vit dans `lib` et non dans un module d'audit parce que deux familles s'en
 * servent désormais — le calendrier éditorial et le ciblage publicitaire — et que les faire
 * s'importer l'une l'autre créerait un cycle. C'est une fonction pure : elle n'a ni base ni
 * réseau, et n'a aucune raison d'appartenir à l'une des deux.
 */
export function langueDuChemin(adresse: string): string | null {
  try {
    const segment = new URL(adresse).pathname.split('/').filter(Boolean)[0] ?? ''
    return /^[a-z]{2}$/u.test(segment) ? segment : null
  } catch {
    return null
  }
}
