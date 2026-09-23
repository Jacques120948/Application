import type { CreditedOperation } from '@/server/billing/credits'

/**
 * Routage des modèles et tarification (exigence 37).
 *
 * Table de configuration plutôt que conditions dispersées : changer de modèle pour une
 * opération se fait ici, et nulle part ailleurs.
 */

export const MODELS = {
  /** Raisonnement structurant : génération complète, diagnostic. */
  reasoning: 'claude-opus-5',
  /** Opérations fréquentes et cadrées par le schéma. */
  fast: 'claude-sonnet-5',
  /**
   * Réponses courtes et nombreuses : l'assistant intégré aux applications créées.
   *
   * Ce sont les visiteurs du créateur qui déclenchent ces appels, et c'est le créateur qui
   * les paie. Le modèle le moins cher est donc le bon choix par défaut.
   */
  economical: 'claude-haiku-4-5',
} as const

export type ModelId = (typeof MODELS)[keyof typeof MODELS]

export type OperationProfile = {
  model: ModelId
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
}

/**
 * La génération complète se fait en deux temps (voir src/server/ai/schemas.ts) et les
 * deux n'ont pas les mêmes besoins : décider la structure demande du raisonnement,
 * rédiger le contenu d'une page est une tâche cadrée par le schéma. Mesuré sur une
 * génération réelle de six pages, ce découpage divise le coût par deux sans perte
 * visible de qualité.
 */
export const GENERATION_STEPS = {
  plan: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'high' },
  page: { model: MODELS.fast, maxTokens: 6_000, effort: 'medium' },
} as const satisfies Record<string, OperationProfile>

/**
 * Ce qu'une opération sollicite.
 *
 * `image` y figure pour que la table reste complète, mais son profil n'est jamais lu : une
 * image ne passe pas par un modèle de texte, elle est demandée à un fournisseur d'images et
 * facturée à l'unité. La laisser hors de la table obligerait à l'assouplir, et on perdrait
 * la garantie qu'aucune opération facturée n'est oubliée.
 */
export const OPERATION_PROFILES: Record<CreditedOperation, OperationProfile> = {
  image: { model: MODELS.economical, maxTokens: 0, effort: 'low' },
  ideas: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'medium' },
  // La validation engage l'utilisateur à construire ou à renoncer : elle mérite le
  // modèle de raisonnement, même si elle est appelée souvent.
  validate: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'high' },
  // Le cahier des charges est lu et approuvé par le créateur, et il commande ensuite la
  // construction : c'est le document le plus structurant du parcours.
  specsheet: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'high' },
  blueprint: { model: MODELS.fast, maxTokens: 3_000, effort: 'medium' },
  generate: { model: MODELS.reasoning, maxTokens: 16_000, effort: 'high' },
  edit: { model: MODELS.fast, maxTokens: 4_000, effort: 'medium' },
  // Réponse courte à un visiteur. Volume potentiellement élevé, enjeu faible par réponse.
  assistant: { model: MODELS.economical, maxTokens: 700, effort: 'low' },
  // Le coach explique le produit, il ne le construit pas. Réponse courte, modèle rapide.
  coach: { model: MODELS.economical, maxTokens: 800, effort: 'low' },
  // Le modèle est en réalité choisi par le moteur social, qui exécute l'appel. Ce profil
  // sert de référence de coût et de garde-fou si le moteur revenait un jour sur place.
  launchKit: { model: MODELS.fast, maxTokens: 8_000, effort: 'medium' },
  // Comme le kit : c'est le moteur social qui exécute et choisit son modèle. Ce profil
  // sert de référence de coût.
  contentVariation: { model: MODELS.fast, maxTokens: 3_000, effort: 'medium' },
  monthlyPlan: { model: MODELS.fast, maxTokens: 16_000, effort: 'medium' },
  /*
   * Les spécialistes raisonnent sur des faits chiffrés et doivent savoir dire « ces chiffres
   * ne permettent pas de conclure ». Le modèle économique s'en tire mal : il conclut quand
   * même. Le modèle rapide est le bon compromis pour une réponse de six phrases.
   */
  specialist: { model: MODELS.fast, maxTokens: 1_200, effort: 'medium' },
  // Comme la recherche d'idées : décider quoi construire demande du raisonnement.
  radar: { model: MODELS.reasoning, maxTokens: 8_000, effort: 'medium' },
  radarCompare: { model: MODELS.fast, maxTokens: 2_000, effort: 'medium' },
  /*
   * Lia répond depuis des entrées déjà écrites : elle reformule, elle n'invente pas. Le
   * modèle économique suffit, et c'est celui qu'il faut pour un volume déclenché par les
   * visiteurs d'autrui.
   */
  liaAnswer: { model: MODELS.economical, maxTokens: 600, effort: 'low' },
  liaFaq: { model: MODELS.fast, maxTokens: 4_000, effort: 'medium' },
  liaInsights: { model: MODELS.fast, maxTokens: 6_000, effort: 'medium' },
  /*
   * Écrire un titre et une description pour dix pages, à partir de ce que chacune contient
   * déjà. Le modèle économique s'en tire mal : il produit des formules interchangeables,
   * exactement ce qu'on reproche aux pages qu'on corrige. Le modèle rapide lit le contenu
   * et en tire ce qui distingue la page.
   */
  visibilityFix: { model: MODELS.fast, maxTokens: 4_000, effort: 'medium' },
  /*
   * Un spécialiste raisonne sur des faits chiffrés et doit savoir dire « ces constats ne
   * permettent pas de conclure ». Le modèle économique s'en tire mal : il conclut quand
   * même. Le modèle rapide est le bon compromis pour une réponse de six phrases.
   */
  visibilityAsk: { model: MODELS.fast, maxTokens: 1_400, effort: 'medium' },
  /*
   * Un article de fond : sept cents mots au minimum, des sections titrées, des
   * questions-réponses et les balises qui vont avec. C'est de loin le plus gros texte que le
   * produit fabrique, d'où le plafond de jetons. Le modèle rapide plutôt que le modèle de
   * raisonnement : la difficulté est d'écrire juste à partir de ce qu'on donne, pas de
   * résoudre quoi que ce soit — et un article coûte assez cher comme ça.
   */
  visibilityArticle: { model: MODELS.fast, maxTokens: 16_000, effort: 'medium' },
  // Proposer des questions demande de la connaissance du marché, pas du raisonnement long :
  // le modèle rapide suffit, et l'appel est court.
  visibilityQuestions: { model: MODELS.fast, maxTokens: 4_000, effort: 'low' },
  /*
   * Écrire court est un exercice de formulation, pas de raisonnement : il s'agit de dire
   * une chose en trente caractères sans répéter les neuf titres voisins. Le modèle rapide
   * suffit, et l'opération doit rester assez peu chère pour qu'on la relance en changeant
   * d'angle — c'est ainsi qu'on trouve le bon titre, pas du premier coup.
   */
  adsElements: { model: MODELS.fast, maxTokens: 4_000, effort: 'low' },
  // Le point regarde tout et doit trancher : c'est du raisonnement, sur un long contexte et
  // une réponse courte. C'est exactement le cas où le modèle de raisonnement se justifie.
  visibilityPoint: { model: MODELS.reasoning, maxTokens: 4_000, effort: 'medium' },
  /*
   * Le résumé d'Oria est un exercice de formulation sur des faits déjà classés : rien n'y
   * est à trancher, l'ordre lui arrive fait. Le modèle de raisonnement serait payé pour un
   * raisonnement qui a déjà eu lieu, dans du code. Le modèle rapide, et un plafond court :
   * cinq phrases.
   */
  oriaResume: { model: MODELS.fast, maxTokens: 1_200, effort: 'low' },
}

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
}

/**
 * Le calcul du coût a déménagé dans `@/server/billing/ai-pricing`.
 *
 * Les tarifs ne sont plus écrits dans le code : ils se règlent depuis l'administration,
 * avec les valeurs d'ici en secours. Ce fichier ne garde que ce qui relève du routage —
 * quel modèle pour quelle tâche, avec quelles bornes.
 */
