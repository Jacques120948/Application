/**
 * Ce qu'on écrit au constructeur à partir d'une analyse de Lia : une demande en langage
 * simple, que la personne peut modifier avant de l'envoyer. Rien n'est appliqué
 * automatiquement — c'est elle qui décide, dans l'onglet « Modifier avec l'IA ».
 *
 * Fichier partagé serveur/client : il ne dépend de rien d'autre.
 */
export type InsightKind = 'frequent_question' | 'feature_request' | 'potential_bug' | 'unanswered'

export function builderRequestFor(insight: { kind: InsightKind; title: string; examples: string[] }): string {
  const detail = insight.examples.length > 0 ? ` Par exemple : ${insight.examples.slice(0, 2).join(' ; ')}.` : ''
  if (insight.kind === 'feature_request') {
    return `Plusieurs utilisateurs demandent : ${insight.title}.${detail} Peux-tu ajouter cela à l'application ?`
  }
  if (insight.kind === 'potential_bug') {
    return `Des utilisateurs signalent un problème : ${insight.title}.${detail} Peux-tu vérifier et corriger ?`
  }
  if (insight.kind === 'unanswered') {
    return `Les utilisateurs demandent souvent : ${insight.title}.${detail} Peux-tu rendre cette information visible dans l'application ?`
  }
  return `Les utilisateurs posent souvent la question : ${insight.title}.${detail} Peux-tu rendre cela plus clair dans l'application ?`
}
