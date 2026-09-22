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
 * Un mot sur les portraits. Les fichiers de `public/equipe` sont pour l'instant des aplats
 * dégradés à l'initiale, aux couleurs de chaque spécialiste. Ils existent pour une raison
 * précise : une image absente laisse une icône cassée, et une icône cassée sur une page
 * d'accueil coûte plus cher qu'un portrait sobre. `scripts/avatars-equipe.ts` les remplace
 * par de vrais portraits sans qu'une ligne change ici — même nom, même dossier.
 *
 * La pastille à initiale du composant reste le filet : elle prend le relais pour tout
 * spécialiste ajouté plus tard sans portrait.
 */

export const VISIBILITY_AGENT_IDS = ['audit', 'seo', 'geo', 'content', 'ads', 'meta'] as const

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
  tint: 'brand' | 'accent' | 'warm' | 'night' | 'sun' | 'sea'
  /**
   * Ce que ce spécialiste fait déjà, aujourd'hui, dans le produit livré.
   *
   * À ne pas confondre avec `feature`, qui ouvre la **conversation** avec lui — et qui reste
   * à construire pour les quatre. Léa analyse déjà, Néo et Gia rédigent déjà des corrections
   * qu'on peut copier ; mais on ne leur écrit pas encore. Décrire une équipe au présent avant
   * qu'elle existe est la façon la plus sûre de décevoir quelqu'un qui s'inscrit, et se
   * taire sur ce qui marche déjà est la façon la plus sûre de ne pas le convaincre.
   */
  atWork: string | null
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
    atWork: 'Elle analyse, elle priorise, et vous pouvez lui écrire.',
    avatar: '/equipe/lea.webp',
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
    atWork: 'Il rédige vos titres, vos descriptions et vos H1, et il répond à vos questions.',
    avatar: '/equipe/neo.webp',
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
    atWork: 'Elle rédige vos introductions, et elle explique ce qu’une IA comprend de vos pages.',
    avatar: '/equipe/gia.webp',
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
    atWork: 'Il écrit à partir de vos pages, sur demande, dans la conversation.',
    avatar: '/equipe/milo.webp',
    tint: 'warm',
    starters: [
      'Réécris la description de cette page.',
      'Propose une FAQ pour ce service.',
      'Quel article devrais-je écrire ensuite ?',
    ],
  },
  /*
   * Naya, et la frontière qu'elle franchit.
   *
   * Les quatre autres travaillent la visibilité qu'on ne paie pas : ce qu'on gagne en
   * écrivant mieux et en étant mieux compris. Naya travaille celle qu'on achète. Ce n'est
   * pas un métier de plus dans le même domaine, c'est un domaine voisin — et c'est
   * exactement pourquoi elle a sa place ici plutôt qu'ailleurs : quelqu'un qui dépense en
   * publicité sur des mots où il sort déjà premier paie pour ce qu'il a déjà, et personne
   * ne le lui dira s'il n'y a pas, dans la même équipe, quelqu'un qui voit les deux.
   *
   * Elle porte aussi le seul pouvoir du produit qui engage de l'argent. Les autres
   * proposent des textes qu'on copie ; elle peut modifier un budget. D'où une règle qui
   * n'existe pour personne d'autre : elle ne modifie rien sans confirmation explicite, et
   * ce qu'elle a modifié est journalisé avec son ancienne valeur.
   */
  {
    id: 'ads',
    name: 'Naya',
    role: 'Publicité',
    summary:
      'Elle lit vos campagnes Google Ads, explique où part votre argent et ce qu’il rapporte, et propose des ajustements. Elle ne modifie rien sans votre accord.',
    handles: ['Campagnes', 'Budgets', 'ROAS et CPA', 'Mots-clés', 'Termes de recherche'],
    feature: 'visibility_ads_agent',
    atWork: null,
    avatar: '/equipe/naya.webp',
    tint: 'sun',
    starters: [
      'Comment vont mes campagnes aujourd’hui ?',
      'Quelle campagne dépense trop ?',
      'Où puis-je augmenter le budget ?',
    ],
  },
  /*
   * MIRA, et pourquoi elle est distincte de Naya plutôt que d'être son second onglet.
   *
   * Les deux achètent de l'audience, et là s'arrête la ressemblance. Chez Google, on paie
   * une intention déjà formée : quelqu'un a tapé « bougie citrine », il cherche. Chez Meta,
   * on paie une interruption : personne ne cherchait rien, et c'est la créative qui doit
   * créer l'envie. D'où des métiers différents — Naya raisonne en mots-clés et en termes de
   * recherche, MIRA en visuels, en audiences et en fatigue publicitaire, une notion qui
   * n'existe pas chez Google parce qu'une requête ne se lasse pas.
   *
   * Les fondre en un seul « agent publicité » aurait donné un généraliste qui conseille la
   * moyenne de deux métiers, c'est-à-dire le mauvais conseil deux fois.
   *
   * Elle hérite en revanche de tout ce que Naya a coûté à construire : les mêmes garde-fous,
   * le même journal avec sa valeur d'avant, le même refus de confier un calcul d'argent à un
   * modèle. Ce sont les règles du produit, pas celles de Google.
   */
  {
    id: 'meta',
    name: 'MIRA',
    role: 'Meta Ads',
    summary:
      'Elle analyse vos campagnes Facebook et Instagram, détecte les opportunités et vous aide à améliorer vos performances publicitaires.',
    handles: ['Campagnes', 'Ensembles', 'Créatives', 'Audiences', 'ROAS et CPA'],
    feature: 'visibility_meta_agent',
    atWork: null,
    /*
     * Aucun portrait déclaré, et c'est volontaire tant que le fichier n'existe pas : une
     * adresse qui pointe vers un fichier manquant n'affiche pas un repli, elle affiche une
     * image cassée. La pastille à initiale prend le relais, et la ligne `avatar` s'ajoutera
     * le jour où `scripts/avatars-equipe.ts` aura produit `mira.webp` comme pour les autres.
     */
    tint: 'sea',
    starters: [
      'Pourquoi mon ROAS baisse ?',
      'Quelle publicité fonctionne le mieux ?',
      'Où est-ce que je perds de l’argent ?',
    ],
  },
]

export function findVisibilityAgent(id: string): VisibilityAgent | undefined {
  return VISIBILITY_AGENTS.find((agent) => agent.id === id)
}
