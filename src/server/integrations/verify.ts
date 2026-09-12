import { verifyAnthropicKey } from './providers/anthropic'

/**
 * Vérification d'un secret avant enregistrement.
 *
 * Le gestionnaire d'intégrations reste générique : il ne sait pas ce qu'est une clé
 * Anthropic. Un fournisseur qui sait vérifier la sienne s'inscrit ici, et le gestionnaire
 * se contente de demander « quelqu'un sait-il valider ceci ? ».
 *
 * Un fournisseur sans vérificateur voit sa clé acceptée telle quelle. C'est un choix
 * volontaire : mieux vaut un fournisseur ouvert sans contrôle préalable qu'un contrôle
 * inventé qui rejetterait des clés valides.
 */
export type KeyVerdict = { ok: true; label: string | null } | { ok: false; reason: string }

export type KeyVerifier = (apiKey: string) => Promise<KeyVerdict>

const VERIFIERS: Record<string, KeyVerifier> = {
  anthropic: verifyAnthropicKey,
}

export function findVerifier(providerId: string): KeyVerifier | undefined {
  return VERIFIERS[providerId]
}
