/**
 * Les spécialistes marketing.
 *
 * Trois métiers, trois regards sur le même projet. Ce qui les rend utiles n'est pas leur
 * ton mais ce qu'ils ont le droit de lire : chacun reçoit des faits vérifiables tirés du
 * projet, et rien d'autre. Un spécialiste qui parlerait dans le vide donnerait des conseils
 * de manuel, que le créateur trouverait mieux écrits ailleurs.
 *
 * Trois règles tiennent cette famille debout.
 *
 * **Chacun a sa fonction.** Un spécialiste s'ouvre par la couche de droits, jamais par une
 * condition sur le nom d'une offre. Déplacer Noah d'une offre à l'autre depuis le
 * back-office ne demande donc pas une ligne de code.
 *
 * **Chacun a son périmètre de lecture.** Mila ne voit pas le kit de lancement, Tom ne voit
 * pas les chiffres de fréquentation. Ce n'est pas une coquetterie : un contexte plus large
 * coûte plus cher à chaque question, pour une réponse moins nette.
 *
 * **Aucun n'invente.** Quand la donnée manque — un projet pas encore publié, aucune visite
 * enregistrée — le contexte le dit explicitement, et la consigne est de le dire aussi.
 */

export const AGENT_IDS = ['social', 'seo', 'analytics'] as const

export type AgentId = (typeof AGENT_IDS)[number]

export type Agent = {
  id: AgentId
  /** Prénom affiché. Un interlocuteur se retient mieux qu'un intitulé de fonction. */
  name: string
  role: string
  /** Ce qu'il sait faire, en une phrase, pour l'écran de choix. */
  summary: string
  /** Identifiant de la fonction qui l'ouvre. Voir server/billing/features.ts. */
  feature: string
  /** Exemples de questions, affichés tant que la conversation est vide. */
  starters: readonly string[]
}

export const AGENTS: readonly Agent[] = [
  {
    id: 'social',
    name: 'Tom',
    role: 'Réseaux sociaux',
    summary:
      'Il connaît votre kit de lancement, ce que vous avez approuvé et ce qui est déjà parti. Il prépare la suite plutôt que de recommencer.',
    feature: 'social_agent',
    starters: [
      'Que devrais-je publier la semaine prochaine ?',
      'Cette semaine se ressemble trop, comment la varier ?',
      'Quel angle n’ai-je pas encore utilisé ?',
    ],
  },
  {
    id: 'seo',
    name: 'Noah',
    role: 'Référencement',
    summary:
      'Il lit les pages réellement publiées : leurs titres, leurs textes, leurs adresses. Il dit ce qui manque pour être trouvé.',
    feature: 'seo_agent',
    starters: [
      'Mes titres de pages sont-ils bons pour la recherche ?',
      'Sur quels mots pourrais-je être trouvé ?',
      'Que manque-t-il à ma page d’accueil ?',
    ],
  },
  {
    id: 'analytics',
    name: 'Mila',
    role: 'Analyse',
    summary:
      'Elle lit vos chiffres réels : visites, pages consultées, inscriptions, données enregistrées. Elle ne devine rien.',
    feature: 'analytics_agent',
    starters: [
      'Que disent mes chiffres des trente derniers jours ?',
      'Quelle page mérite le plus d’attention ?',
      'Mes visiteurs vont-ils au bout ?',
    ],
  },
]

export function findAgent(id: string): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id)
}

/**
 * Fonction qui relie les spécialistes entre eux.
 *
 * Sans elle, chacun répond dans son coin. Avec elle, chacun reçoit la dernière phrase
 * retenue par ses collègues : Mila constate qu'une page attire, Tom le sait à sa question
 * suivante. C'est le seul effet de cette fonction, et c'est tout ce que « équipe » veut
 * dire ici — pas un quatrième interlocuteur, une mémoire commune.
 */
export const TEAM_FEATURE = 'marketing_team'
