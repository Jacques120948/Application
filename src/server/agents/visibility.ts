import { membre, type MembreEquipe } from '@/lib/equipe'
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

export const VISIBILITY_AGENT_IDS = [
  'oria',
  'audit',
  'seo',
  'geo',
  'content',
  'cro',
  'ads',
  'meta',
  'nova',
] as const

export type VisibilityAgentId = (typeof VISIBILITY_AGENT_IDS)[number]

export type VisibilityAgent = MembreEquipe & {
  id: VisibilityAgentId
  /** Ce qu'il fait, en une phrase, pour l'écran de choix et la page publique. */
  summary: string
  /** Ce qu'il sait traiter. Des noms de choses, pas des promesses. */
  handles: readonly string[]
  /** Identifiant de la fonction qui l'ouvre. Voir server/billing/features.ts. */
  feature: string
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

/**
 * L'identité d'un membre, tirée du fichier partagé plutôt que recopiée.
 *
 * Le menu du studio affiche la même équipe, et un composant de navigateur ne peut pas
 * importer une valeur du serveur. Sans source unique, un prénom changé ici laisserait
 * l'ancien dans la navigation — et personne ne verrait l'écart avant un client.
 *
 * Lève si l'identifiant est inconnu : c'est une erreur de programmation, pas un cas limite,
 * et elle doit tomber à la construction du module plutôt que sur un écran vide.
 */
function identite(id: string): MembreEquipe {
  const trouve = membre(id)
  if (trouve === undefined) throw new Error(`Membre d'équipe inconnu : ${id}`)
  return trouve
}

export const VISIBILITY_AGENTS: readonly VisibilityAgent[] = [
  /*
   * Oria d'abord, parce qu'elle ne fait pas le même travail que les sept autres.
   *
   * Chacun d'eux regarde un sujet et le regarde bien. Aucun ne sait ce qu'il faut faire en
   * premier, parce qu'aucun ne voit ce que les autres ont trouvé : Naya ne sait pas que les
   * pages convertissent mal, Cleo ne sait pas qu'on paie pour y envoyer du monde. Oria lit
   * leurs constats — déjà calculés, déjà enregistrés — et les classe. Elle n'en refait
   * aucun : demander à Cleo est moins cher et plus juste que de redevenir Cleo.
   */
  {
    ...identite('oria'),
    summary:
      'La vue d’ensemble : elle rassemble ce que vos spécialistes ont trouvé, le classe, et dit par quoi commencer cette semaine.',
    handles: [
      'Par quoi commencer',
      'Priorités',
      'Santé marketing',
      'Répartition des efforts',
      'Ce qui a bougé',
      'Qui peut s’en charger',
    ],
    feature: 'oria_agent',
    /*
     * Ce qu'elle fait, et la limite qui compte : elle ne mesure rien elle-même. Tout ce
     * qu'elle avance vient d'un constat qu'un spécialiste a déjà rendu. Laisser croire
     * qu'elle observe le marché ou les ventes serait la façon la plus sûre de décevoir
     * quelqu'un qui découvrirait qu'elle relit ses propres agents.
     */
    atWork:
      'Elle lit les constats déjà rendus par votre équipe, les classe par ce qu’ils coûtent et ce qu’ils demandent, et dit par quoi commencer. Elle ne mesure rien par elle-même : tout ce qu’elle avance vient d’un de vos spécialistes.',
    starters: [
      'Que dois-je faire aujourd’hui ?',
      'Quelle est ma priorité cette semaine ?',
      'Où est-ce que je perds le plus ?',
      'Dois-je augmenter mes budgets publicitaires ?',
      'Qui dans l’équipe a trouvé quelque chose ?',
    ],
  },
  {
    ...identite('audit'),
    summary:
      'Elle lit votre site page par page, relève ce qui cloche et dit par quoi commencer. Elle constate : elle ne touche à rien.',
    handles: ['Analyse du site', 'Problèmes détectés', 'Priorités', 'Progression'],
    feature: 'visibility_audit_agent',
    atWork: 'Elle analyse, elle priorise, et vous pouvez lui écrire.',
    starters: [
      'Pourquoi mon score a-t-il baissé ?',
      'Par quoi devrais-je commencer ?',
      'Quelles pages méritent le plus d’attention ?',
    ],
  },
  {
    ...identite('seo'),
    summary:
      'Il travaille ce qu’un moteur de recherche regarde : les titres, les descriptions, la structure et les liens entre vos pages.',
    handles: ['Titles', 'Meta descriptions', 'H1 et H2', 'Structure', 'Maillage interne'],
    feature: 'visibility_seo_agent',
    atWork: 'Il rédige vos titres, vos descriptions et vos H1, et il répond à vos questions.',
    starters: [
      'Mes titres de pages sont-ils bons ?',
      'Que manque-t-il à ma page d’accueil ?',
      'Comment corriger mes fiches produits ?',
    ],
  },
  {
    ...identite('geo'),
    summary:
      'Elle rend vos pages compréhensibles par les assistants : des réponses directes, des faits nets, une entreprise clairement identifiée.',
    handles: ['Réponses directes', 'FAQ', 'Données structurées', 'Identité de la marque'],
    feature: 'visibility_geo_agent',
    atWork: 'Elle rédige vos introductions, et elle explique ce qu’une IA comprend de vos pages.',
    starters: [
      'Pourquoi mon score GEO est-il bas ?',
      'Mes pages répondent-elles aux vraies questions ?',
      'Que comprend une IA de mon entreprise ?',
    ],
  },
  {
    ...identite('content'),
    summary:
      'Il écrit et réécrit : descriptions, pages, questions fréquentes, articles. Toujours à partir de votre site, jamais à partir d’un modèle générique.',
    handles: ['Descriptions', 'Pages', 'FAQ', 'Articles', 'Introductions'],
    feature: 'visibility_content_agent',
    atWork: 'Il écrit à partir de vos pages, sur demande, dans la conversation.',
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
  /*
   * Cleo passe avant les publicitaires, comme dans le menu, et pour la même raison : elle
   * travaille sur le trafic qu'on a déjà. Un visiteur qu'on convertit mieux ne se rachète
   * pas, et dépenser en publicité avant d'avoir regardé où l'on perd les gens revient à
   * remplir un seau percé.
   */
  {
    ...identite('cro'),
    summary:
      'Elle lit votre site du point de vue de quelqu’un qui hésite à acheter, et relève ce qui le fait partir : une promesse floue, un bouton qu’on ne trouve pas, une livraison qu’on découvre trop tard.',
    handles: [
      'Proposition de valeur',
      'Boutons d’action',
      'Réassurance',
      'Points de friction',
      'Fiches produits',
      'Formulaires',
      'Expérience mobile',
    ],
    feature: 'visibility_cro_agent',
    /*
     * Ce qu'elle fait aujourd'hui, et rien de plus. Elle lit les pages — le même passage que
     * Léa, sans lecture supplémentaire — et en tire des constats calculés.
     *
     * Ce qui n'est PAS promis ici l'est délibérément : elle ne voit ni vos visiteurs, ni vos
     * ventes, ni votre tunnel. Aucune source de mesure n'est reliée à Evoliia. Annoncer « je
     * mesure vos conversions » à quelqu'un qui trouverait une analyse de pages serait la
     * façon la plus sûre de décevoir quelqu'un qui vient de payer. La phrase s'élargira
     * quand une mesure existera, pas avant.
     */
    atWork:
      'Elle analyse vos pages à chaque audit et dit ce qui peut faire hésiter un visiteur. Elle ne mesure pas encore vos ventes : aucune source de conversion n’est reliée.',
    starters: [
      'Pourquoi mes visiteurs n’achètent-ils pas ?',
      'Quelle page dois-je améliorer en premier ?',
      'Qu’est-ce qui manque à mes fiches produits ?',
      'Donne-moi trois améliorations simples.',
      'Mon bouton d’achat est-il assez visible ?',
    ],
  },
  {
    ...identite('ads'),
    summary:
      'Elle lit vos campagnes Google Ads, explique où part votre argent et ce qu’il rapporte, et propose des ajustements. Elle ne modifie rien sans votre accord.',
    handles: ['Campagnes', 'Budgets', 'ROAS et CPA', 'Mots-clés', 'Termes de recherche'],
    feature: 'visibility_ads_agent',
    /*
     * Cette ligne disait « à venir » longtemps après que Naya eut commencé à travailler, et
     * c'est une erreur du même genre que la promesse excessive, dans l'autre sens : annoncer
     * moins que ce qu'on fait coûte des clients à qui l'on avait la réponse.
     *
     * Elle dit donc ce qui existe, et s'arrête là. « Que vous confirmez » n'est pas une
     * formule de prudence : c'est le fonctionnement, et il ne changera pas.
     */
    atWork:
      'Elle lit vos campagnes Google Ads, dit où part votre argent, et prépare des mots-clés et des campagnes que vous confirmez.',
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
    ...identite('meta'),
    summary:
      'Elle analyse vos campagnes Facebook et Instagram, détecte les opportunités et vous aide à améliorer vos performances publicitaires.',
    handles: ['Campagnes', 'Ensembles', 'Créatives', 'Audiences', 'ROAS et CPA'],
    feature: 'visibility_meta_agent',
    /*
     * Ce qu'elle fait aujourd'hui, et pas une ligne de plus. Elle ne modifie encore rien
     * chez Meta : le jour où elle le fera, cette phrase le dira.
     */
    atWork:
      'Elle lit vos campagnes Facebook et Instagram, repère ce qui fatigue votre audience, et vous dit ce qui mérite d’être changé.',
    starters: [
      'Pourquoi mon ROAS baisse ?',
      'Quelle publicité fonctionne le mieux ?',
      'Où est-ce que je perds de l’argent ?',
    ],
  },
  /*
   * Nova, et la frontière qu'elle ne franchit pas.
   *
   * Les autres travaillent ; elle mesure ce que leur travail a donné. Elle lit les ventes de
   * la boutique, les dépenses et les déclarations des régies, et les confronte — c'est la
   * seule de l'équipe à pouvoir dire que Google et Meta revendiquent ensemble plus que ce
   * qui a été vendu. Elle ne touche à rien : ni budget, ni campagne, ni page.
   *
   * Elle n'est pas un tableau de bord de plus. Chaque chiffre est calculé par du code, et
   * elle en tire ce qui a changé, ce qui marche mieux que le reste, et qui peut s'en occuper.
   */
  {
    ...identite('nova'),
    summary:
      'Nova rassemble vos données marketing et vous montre ce qui génère réellement des résultats.',
    handles: [
      'Chiffre d’affaires',
      'Dépenses marketing',
      'ROAS et MER',
      'Coût d’acquisition',
      'Performance par canal',
      'Attribution',
    ],
    feature: 'nova_agent',
    /*
     * Ce qu'elle fait aujourd'hui, et ce qu'il lui faut pour le faire. Sans boutique reliée,
     * elle n'a que les déclarations des régies : la phrase le dit plutôt que de laisser
     * attendre un chiffre d'affaires qui n'arrivera pas.
     */
    atWork:
      'Elle rassemble vos ventes Shopify, vos visites Google Analytics 4, vos dépenses Google Ads et Meta Ads et vos clics Google, calcule ce qui rapporte réellement et signale ce qui change. Sans boutique reliée, elle ne voit que ce que déclarent les régies.',
    starters: [
      'Quel canal me rapporte le plus ?',
      'Quel est mon vrai ROAS ?',
      'Où est-ce que je perds de l’argent ?',
      'Qu’est-ce qui a changé cette semaine ?',
      'Quels sont mes 3 chiffres les plus importants aujourd’hui ?',
    ],
  },
]

export function findVisibilityAgent(id: string): VisibilityAgent | undefined {
  return VISIBILITY_AGENTS.find((agent) => agent.id === id)
}
