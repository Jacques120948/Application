import type { SupportCategory } from '@/server/ai/schemas'

/**
 * Catégorie d'une demande, sans appel au modèle.
 *
 * Sert quand Lia n'a pas répondu (ticket ouvert directement) ou en secours. C'est une
 * lecture de mots, pas une compréhension : suffisante pour trier une boîte, jamais pour
 * juger une personne. La catégorie reste modifiable par le créateur.
 */
const RULES: Array<{ category: SupportCategory; words: RegExp }> = [
  { category: 'billing', words: /factur|paiement|payer|prix|tarif|rembours|abonnement|carte|invoice|payment|refund|price|billing/i },
  { category: 'account', words: /mot de passe|connexion|connecter|compte|identifiant|inscription|e-?mail|password|login|sign ?in|account/i },
  { category: 'bug', words: /bug|erreur|ne (fonctionne|marche) (pas|plus)|bloqu|plant|écran blanc|impossible de|error|crash|broken|doesn'?t work/i },
  { category: 'feature', words: /serait bien|pourriez-vous ajouter|ajouter|manque|suggestion|améliorer|would be nice|could you add|feature|missing/i },
  { category: 'usage', words: /comment|où|utiliser|fonctionne|how (do|to|can)|where/i },
]

export function classify(text: string): SupportCategory {
  const sample = text.slice(0, 1000)
  for (const rule of RULES) if (rule.words.test(sample)) return rule.category
  return 'other'
}

/** Priorité déduite de la catégorie : un bug ou un paiement passe devant une suggestion. */
export function priorityFor(category: SupportCategory): 'low' | 'normal' | 'high' {
  if (category === 'bug' || category === 'billing') return 'high'
  if (category === 'feature') return 'low'
  return 'normal'
}
