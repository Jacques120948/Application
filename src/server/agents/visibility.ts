/**
 * L'équipe de visibilité.
 *
 * Quatre métiers, un seul site à faire remonter. Ce qui en fait une équipe et non quatre
 * boutons n'est ni leur prénom ni leur portrait : c'est que chacun regarde autre chose et
 * peut faire autre chose. Léa constate et ne touche à rien ; Néo travaille la forme ; Gia
 * travaille ce qu'une machine comprend ; Milo écrit. Un spécialiste qui aurait accès à tout
 * ne serait qu'un assistant généraliste affublé d'un prénom, et chacun le sentirait au bout
 * de trois échanges.
 *
 * Trois règles, reprises de l'équipe marketing qui les avait déjà éprouvées.
 *
 * **Chacun s'ouvre par la couche de droits**, jamais par une condition sur le nom d'une
 * offre. Déplacer Gia d'une offre à l'autre depuis le back-office ne demande pas une ligne
 * de code.
 *
 * **Chacun a son périmètre de lecture.** Ce n'est pas une coquetterie : un contexte plus
 * large coûte plus cher à chaque question, pour une réponse moins nette.
 *
 * **Aucun n'invente.** Les scores et les constats sont calculés par du code, jamais par un
 * modèle. Un agent reçoit des faits mesurés et les explique ; il ne les devine pas, et quand
 * la donnée manque, le contexte le dit et la consigne est de le dire aussi.
 *
 * Un mot sur les portraits. Ils sont pour l'instant des monogrammes : une pastille, une
 * initiale, une couleur. Ce n'est pas un provisoire honteux — c'est lisible, cohérent,
 * gratuit, et ça ne fait passer personne pour une personne réelle. Le jour où de vrais
 * portraits existeront, ils se posent dans `avatar` sans toucher au reste.
 */

export const VISIBILITY_AGENT_IDS = ['audit', 'seo', 'geo', 'content'] as const

export type VisibilityAgentId = (typeof VISIBILITY_AGENT_IDS)[number]

export type VisibilityAgent = {
  id: VisibilityAgentId
  /** Prénom affiché. Un interlocuteur se retient mieux qu'un intitulé de fonction. */
  name: string
  /** Sa spécialité, en deux mots. */
  role: string
  /** Ce qu'il fait, en une phrase, pour l'écran de choix et la page publique. */
  summary: string
  /** Ce qu'il sait traiter. Des noms de choses, pas des promesses. */
  handles: readonly string[]
  /** Identifiant de la fonction qui l'ouvre. Voir server/billing/features.ts. */
  feature: string
  /**
   * Portrait, quand il existe. Absent : la pastille à initiale prend le relais, ce qui est
   * le cas aujourd'hui pour les quatre.
   */
  avatar?: string
  /** Jeton de couleur de sa pastille. Fond tendre, lettre sombre : lisible partout. */
  tint: 'brand' | 'accent' | 'warm' | 'night'
  /** Exemples de questions, affichés tant que la conversation est vide. */
  starters: readonly string[]
}

export const VISIBILITY_AGENTS: readonly VisibilityAgent[] = [
  {
    id: 'audit',
    name: 'Léa',
    role: 'Audit',
    summary:
      'Elle lit votre site page par page, relève ce qui cloche et dit par quoi commencer. Elle constate : elle ne touche à rien.',
    handles: ['Analyse du site', 'Problèmes détectés', 'Priorités', 'Progression'],
    feature: 'visibility_audit_agent',
    tint: 'brand',
    starters: [
      'Pourquoi mon score a-t-il baissé ?',
      'Par quoi devrais-je commencer ?',
      'Quelles pages méritent le plus d’attention ?',
    ],
  },
  {
    id: 'seo',
    name: 'Néo',
    role: 'Référencement',
    summary:
      'Il travaille ce qu’un moteur de recherche regarde : les titres, les descriptions, la structure et les liens entre vos pages.',
    handles: ['Titles', 'Meta descriptions', 'H1 et H2', 'Structure', 'Maillage interne'],
    feature: 'visibility_seo_agent',
    tint: 'night',
    starters: [
      'Mes titres de pages sont-ils bons ?',
      'Que manque-t-il à ma page d’accueil ?',
      'Comment corriger mes fiches produits ?',
    ],
  },
  {
    id: 'geo',
    name: 'Gia',
    role: 'Moteurs IA',
    summary:
      'Elle rend vos pages compréhensibles par les assistants : des réponses directes, des faits nets, une entreprise clairement identifiée.',
    handles: ['Réponses directes', 'FAQ', 'Données structurées', 'Identité de la marque'],
    feature: 'visibility_geo_agent',
    tint: 'accent',
    starters: [
      'Pourquoi mon score GEO est-il bas ?',
      'Mes pages répondent-elles aux vraies questions ?',
      'Que comprend une IA de mon entreprise ?',
    ],
  },
  {
    id: 'content',
    name: 'Milo',
    role: 'Contenu',
    summary:
      'Il écrit et réécrit : descriptions, pages, questions fréquentes, articles. Toujours à partir de votre site, jamais à partir d’un modèle générique.',
    handles: ['Descriptions', 'Pages', 'FAQ', 'Articles', 'Introductions'],
    feature: 'visibility_content_agent',
    tint: 'warm',
    starters: [
      'Réécris la description de cette page.',
      'Propose une FAQ pour ce service.',
      'Quel article devrais-je écrire ensuite ?',
    ],
  },
]

export function findVisibilityAgent(id: string): VisibilityAgent | undefined {
  return VISIBILITY_AGENTS.find((agent) => agent.id === id)
}
