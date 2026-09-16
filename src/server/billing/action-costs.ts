/**
 * Ce que coûte chaque action, en crédits.
 *
 * La règle qui décide de tout le reste : **ce qui se compte ne se paie pas.** Un H1 absent,
 * un titre trop long, une image sans texte alternatif, une balise manquante, une erreur de
 * serveur — tout cela se constate par du calcul, en quelques millisecondes et sans appeler
 * personne. Le faire payer reviendrait à facturer une addition.
 *
 * Les crédits ne partent que lorsqu'un modèle travaille vraiment : rédiger, reformuler,
 * expliquer, juger un contenu. C'est la seule dépense réelle d'Evoliia, et c'est donc la
 * seule qui se répercute.
 *
 * Les fourchettes ci-dessous sont indicatives et servent à annoncer un ordre de grandeur
 * avant de lancer une action. Le débit réel, lui, est mesuré sur les jetons réellement
 * consommés : personne n'est facturé sur une estimation.
 */

export type ActionCost = {
  id: string
  /** Ce que la personne demande, dit comme elle le dirait. */
  label: string
  min: number
  max: number
}

/**
 * Valeurs de départ, à l'échelle de ce qu'un modèle rend pour chacune.
 *
 * Un titre est une phrase ; un article est une page. Il serait absurde qu'ils coûtent la
 * même chose, et la grille doit se comprendre sans explication : plus le texte rendu est
 * long, plus il coûte.
 */
export const DEFAULT_ACTION_COSTS: readonly ActionCost[] = [
  { id: 'meta', label: 'Réécrire un titre ou une description', min: 1, max: 1 },
  { id: 'analyse', label: 'Analyser le contenu d’une page en détail', min: 2, max: 3 },
  { id: 'faq', label: 'Rédiger une foire aux questions', min: 3, max: 5 },
  { id: 'page', label: 'Améliorer une page entière', min: 5, max: 10 },
  { id: 'article', label: 'Écrire un article', min: 15, max: 30 },
]

/** Ce qui ne coûte rien, et qu'il faut dire aussi clairement que ce qui coûte. */
export const FREE_ACTIONS: readonly string[] = [
  'Parcourir votre site',
  'Tous les contrôles techniques',
  'Les deux notes sur 100',
  'Le classement des priorités',
  'L’historique de vos audits',
]
