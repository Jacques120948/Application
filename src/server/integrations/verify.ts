import { verifyAnthropicKey } from './providers/anthropic'
import { verifyPostelyaCode } from './providers/postelya'

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
export type KeyVerdict =
  | {
      ok: true
      label: string | null
      /**
       * Secret à conserver, quand il diffère de celui que le créateur a saisi.
       *
       * Certains services ne se relient pas avec une clé durable mais avec un code
       * d'appairage : court, valable quelques minutes, utilisable une seule fois. Ce qui
       * doit être gardé n'est alors pas ce code, déjà périmé, mais l'autorisation obtenue
       * en l'échangeant. Absent, c'est la saisie du créateur qui est conservée.
       */
      secret?: string
    }
  | { ok: false; reason: string }

export type KeyVerifier = (apiKey: string) => Promise<KeyVerdict>

const VERIFIERS: Record<string, KeyVerifier> = {
  anthropic: verifyAnthropicKey,
  postelya: verifyPostelyaCode,
}

export function findVerifier(providerId: string): KeyVerifier | undefined {
  return VERIFIERS[providerId]
}
