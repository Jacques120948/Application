import { checkCreatorKey } from '@/server/ai/client'
import type { KeyVerifier } from '../verify'

/**
 * Connecteur « clé Anthropic du créateur ».
 *
 * Premier connecteur ouvert, et ce n'est pas un hasard : c'est le seul dont le coût pour
 * Evoliia est structurellement nul. Le créateur donne sa propre clé, ses visiteurs
 * consomment son propre compte, et Evoliia ne relaie que les octets. Aucun quota partagé,
 * aucune facture différée, aucune vérification à obtenir chez le fournisseur.
 *
 * Ce que ce module fait, et rien d'autre : dire si une clé est valide avant qu'elle soit
 * enregistrée. Le chiffrement, le cloisonnement et la limite d'offre sont l'affaire du
 * gestionnaire, qui ne connaît aucun fournisseur en particulier.
 */
export const verifyAnthropicKey: KeyVerifier = async (apiKey) => {
  const result = await checkCreatorKey(apiKey)
  return result.ok ? { ok: true, label: result.label } : { ok: false, reason: result.reason }
}
