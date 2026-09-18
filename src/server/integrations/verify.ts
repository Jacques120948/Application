import { verifyAnthropicKey } from './providers/anthropic'
import { verifyPostelyaCode } from './providers/postelya'
import { verifyOpenAiKey } from './providers/openai'
import { verifyGeminiKey } from './providers/gemini'
import { verifyShopifyToken } from './providers/shopify'

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
      /**
       * Ce dont l'indice doit être tiré, quand le secret conservé n'est pas ce que la
       * personne reconnaîtrait.
       *
       * Un accès Shopify est une paire — la boutique et le jeton — et c'est la paire qui est
       * conservée. Les quatre derniers signes de cette paire ne diraient rien à personne ;
       * ceux du jeton, si. Absent, l'indice porte sur le secret conservé.
       */
      hint?: string
    }
  | { ok: false; reason: string }

/**
 * `champs` porte ce que le catalogue a demandé en plus de la clé, par `extraFields`. Les
 * clés sont les `name` déclarés, et rien d'autre : le gestionnaire écarte le reste avant
 * d'appeler, pour qu'un champ inventé par le navigateur n'atteigne jamais un fournisseur.
 */
export type KeyVerifier = (
  apiKey: string,
  champs?: Readonly<Record<string, string>>,
) => Promise<KeyVerdict>

const VERIFIERS: Record<string, KeyVerifier> = {
  anthropic: verifyAnthropicKey,
  postelya: verifyPostelyaCode,
  openai: verifyOpenAiKey,
  'google-gemini': verifyGeminiKey,
  shopify: verifyShopifyToken,
}

export function findVerifier(providerId: string): KeyVerifier | undefined {
  return VERIFIERS[providerId]
}
