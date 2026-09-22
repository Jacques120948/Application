import type { Jetons } from '@/server/integrations/oauth'

/**
 * Ce qu'une plateforme publicitaire doit savoir faire.
 *
 * L'abstraction existe avant le second fournisseur, et c'est délibéré. Écrire Naya
 * directement autour de Google Ads aurait coûté zéro aujourd'hui et une réécriture le jour
 * de Meta — non pas parce que les appels diffèrent, mais parce que les concepts diffèrent
 * juste assez pour que le code se remplisse de conditions. Un budget quotidien chez Google
 * est un objet partagé entre campagnes ; chez Meta il appartient à l'ensemble de
 * publicités. Ces différences se rangent derrière une frontière, ou elles se répandent.
 *
 * Trois règles portent cette frontière.
 *
 * **Rien de propre à Google ne la franchit.** Pas de « customer ID », pas de GAQL, pas de
 * `resourceName`. Ce qui sort est un compte, des campagnes, des journées — des mots que
 * Meta et Microsoft emploient aussi.
 *
 * **L'argent est en micros, partout.** Un millionième d'unité monétaire, en entier. C'est
 * la convention de Google, elle est saine, et l'adopter partout évite le pire des mondes :
 * une conversion en nombre à virgule faite deux fois, une fois dans chaque sens.
 *
 * **Aucune méthode ne lève.** Un refus est une valeur de retour. Une plateforme
 * indisponible est un état ordinaire, pas une panne du produit, et le code appelant doit
 * pouvoir en rendre compte à la personne plutôt que de casser un écran.
 */

/** Un compte publicitaire, tel que la personne le reconnaîtra dans sa propre interface. */
export type CompteAds = {
  compteId: string
  nom: string
  /** CHF, EUR, USD… telle que la plateforme la déclare. Jamais déduite. */
  devise: string
  /** Le fuseau du compte : c'est lui qui décide où commence une journée de dépense. */
  fuseau: string
  /** Un compte administrateur ne diffuse pas de publicité : il en gère d'autres. */
  gestionnaire: boolean
}

export type CampagneAds = {
  campagneId: string
  nom: string
  /** Le vocabulaire de la plateforme, repris tel quel : SEARCH, SHOPPING, PERFORMANCE_MAX. */
  type: string
  /** ENABLED | PAUSED | REMOVED. On n'invente pas un vocabulaire par-dessus. */
  statut: string
  budgetMicros: number
  /**
   * L'identifiant du budget, quand la plateforme le sépare de la campagne.
   *
   * Chez Google, un budget peut servir plusieurs campagnes. Le modifier sans le savoir
   * changerait la dépense d'une campagne qu'on ne regardait pas — d'où sa présence ici, et
   * la vérification qui viendra avant toute écriture.
   */
  budgetId: string
  /** La plateforme signale que la campagne est bridée par son budget. */
  budgetLimite: boolean
}

/** Une journée d'une campagne. L'unité de tout ce que Naya sait dire. */
export type JourneeAds = {
  campagneId: string
  /** AAAA-MM-JJ, dans le fuseau du compte. */
  jour: string
  coutMicros: number
  impressions: number
  clics: number
  /** Fractionnaire : les conversions pondérées se comptent au dixième. */
  conversions: number
  valeurConversion: number
}

/**
 * Un contenant d'annonces.
 *
 * Une campagne Recherche range ses annonces dans des « groupes d'annonces » ; une
 * Performance Max range ses titres et ses images dans des « groupes d'éléments ». Deux mots
 * de Google pour un même rôle. Les garder distincts jusqu'à l'écran remplirait tout le code
 * de conditions, et Meta apporterait un troisième mot.
 */
export type GroupeAds = {
  groupeId: string
  campagneId: string
  nom: string
  /** annonces | elements — le rôle, pas le mot de la plateforme. */
  genre: 'annonces' | 'elements'
  statut: string
}

/**
 * Les champs qu'un morceau d'annonce peut occuper.
 *
 * `mot-cle` n'est pas un morceau d'annonce : c'est ce que le contenant cible. Il est rangé
 * au même endroit parce qu'il a la même vie — il appartient au contenant, il disparaît avec
 * lui, et il se relit au même rythme. Mais il ne compte jamais dans le remplissage : un
 * groupe n'a pas « 9 titres sur 15 » parce qu'il a six mots-clés.
 */
export type ChampAds = 'titre' | 'titre-long' | 'description' | 'image' | 'logo' | 'mot-cle'

/** Un morceau d'annonce : un titre, une description, une image. */
export type ElementAds = {
  groupeId: string
  champ: ChampAds
  /** Le texte, ou l'adresse de l'image. */
  texte: string
  /** L'identifiant chez la plateforme, quand elle en donne un. */
  elementId: string
  /**
   * La note de la plateforme, reprise telle quelle : LOW, GOOD, BEST, LEARNING, PENDING.
   *
   * Jamais traduite en note sur cent. Ce n'en est pas une — c'est un classement relatif
   * entre les morceaux d'un même contenant — et la convertir inventerait une échelle.
   */
  performance: string
}

/**
 * Une annonce responsive, telle qu'il faut la connaître pour y ajouter un texte.
 *
 * Google ne sait pas « ajouter un titre » : il remplace la liste entière. Y ajouter le
 * seizième exige donc de connaître les quinze autres à l'instant où l'on écrit — et
 * d'emporter leur épinglage, sinon un titre épinglé en première position redeviendrait
 * libre sans que personne l'ait demandé.
 *
 * C'est aussi pourquoi cette lecture est faite juste avant l'écriture et non reprise de la
 * base : entre la lecture hebdomadaire et le dépôt, quelqu'un a pu modifier l'annonce dans
 * Google Ads. Renvoyer une liste vieille d'une semaine effacerait son travail.
 */
export type AnnonceAds = {
  /** Le nom de ressource complet chez la plateforme : c'est lui qu'on renvoie pour écrire. */
  resourceName: string
  titres: TexteAnnonceAds[]
  descriptions: TexteAnnonceAds[]
}

export type TexteAnnonceAds = {
  texte: string
  /**
   * La position où ce texte est figé, quand il l'est : HEADLINE_1, DESCRIPTION_2…
   *
   * Vide quand le texte est libre. Reprise telle quelle et renvoyée telle quelle : la
   * perdre déplacerait un texte que la personne avait délibérément fixé.
   */
  epingle: string
}

/** Un terme réellement tapé par quelqu'un, et ce qu'il a donné. */
export type TermeAds = {
  campagneId: string
  terme: string
  impressions: number
  clics: number
  conversions: number
  coutMicros: number
}

/**
 * Ce que le planificateur de Google dit d'un mot-clé.
 *
 * C'est la moitié que Search Console ne peut pas donner. Search Console dit ce que les gens
 * ont tapé pour trouver **ce site** : une demande réelle, mais vue par le petit bout. Le
 * planificateur dit ce que le marché tape et ce qu'il en coûterait d'y acheter un clic.
 * Décider d'un achat sur Search Console seul reviendrait à payer pour des visites qu'on
 * obtient déjà gratuitement, sans savoir à quel prix.
 */
export type IdeeMotCle = {
  texte: string
  /** Recherches mensuelles moyennes. 0 : Google n'en donne pas, ce qui arrive et se dit. */
  volume: number
  /** LOW | MEDIUM | HIGH, tel que Google le rend. Jamais traduit en note. */
  concurrence: string
  /** La fourchette du coût par clic en haut de page, en micros de la devise du compte. */
  coutBasMicros: number
  coutHautMicros: number
  /**
   * Les formes que la plateforme regroupe sous ce mot-clé.
   *
   * « quartz rose » et « quartzrose », « opaline pierre » et « pierre opaline » : Google les
   * compte comme une seule recherche et rend les mêmes chiffres pour les deux. Les ignorer
   * faisait occuper six emplacements sur douze par des doublons — douze emplacements payés
   * pour six achats distincts.
   */
  variantes: string[]
}

/** Ce que rend une lecture : des données, ou une raison dite à quelqu'un qui n'est pas développeur. */
export type Lecture<T> = { ok: true; valeur: T } | { ok: false; raison: string }

/**
 * Un accès à un compte, tel que les lectures le reçoivent.
 *
 * Le jeton d'accès est renouvelé en amont par `useOAuthAccess` : un fournisseur ne gère pas
 * son propre cycle de vie de jeton, sans quoi chacun le ferait à sa façon.
 */
export type AccesAds = {
  accessToken: string
  compteId: string
}

export type AdPlatformProvider = {
  /** Identifiant dans le catalogue des connecteurs : « google-ads ». */
  id: string
  nom: string
  /** Faux quand l'exploitant n'a pas posé les variables : la connexion reste alors fermée. */
  estConfigure: () => boolean
  /** L'adresse de l'écran de consentement, avec l'état signé qui protège le retour. */
  urlAutorisation: (etat: string) => string
  echangerCode: (code: string) => Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }>
  rafraichir: (
    refreshToken: string,
  ) => Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }>
  /** Les comptes auxquels cette autorisation donne accès. */
  listerComptes: (accessToken: string) => Promise<Lecture<CompteAds[]>>
  lireCampagnes: (acces: AccesAds) => Promise<Lecture<CampagneAds[]>>
  /** Les journées, bornes comprises, en AAAA-MM-JJ. */
  lireJournees: (acces: AccesAds, depuis: string, jusqua: string) => Promise<Lecture<JourneeAds[]>>
  /**
   * Les contenants et leurs morceaux, en une lecture.
   *
   * Rendus ensemble parce qu'ils se lisent ensemble : un morceau sans son contenant n'a nulle
   * part où aller, et deux appels séparés doubleraient une consommation de plafond partagé
   * pour la même information.
   */
  lireCreatif: (acces: AccesAds) => Promise<Lecture<{ groupes: GroupeAds[]; elements: ElementAds[] }>>
  /**
   * Ce que les gens ont tapé, bornes comprises.
   *
   * Vide pour les campagnes qui n'en rendent pas : une Performance Max ne livre que des
   * catégories agrégées. C'est une limite de la plateforme, et l'appelant doit la dire.
   */
  lireTermes: (acces: AccesAds, depuis: string, jusqua: string) => Promise<Lecture<TermeAds[]>>
  /**
   * Les annonces d'un contenant, lues à l'instant où l'on va écrire.
   *
   * Séparée de `lireCreatif`, qui lit tout le compte une fois par semaine pour l'afficher.
   * Celle-ci lit un seul contenant, juste avant une écriture, parce qu'une liste vieille
   * d'une semaine effacerait ce que la personne a fait entre-temps dans Google Ads.
   */
  lireAnnoncesDuGroupe: (acces: AccesAds, groupeId: string) => Promise<Lecture<AnnonceAds[]>>
  /**
   * Combien d'éléments un groupe porte déjà, par champ de la plateforme.
   *
   * Lu avant d'écrire, et c'est la leçon d'un vrai refus : Google compte ses limites par
   * type de champ, et il les vérifie au rattachement — c'est-à-dire après la création de
   * l'élément. Un rattachement refusé laisse donc un élément orphelin dans le compte, que
   * l'API ne sait pas supprimer. Compter avant est la seule façon de ne pas en semer.
   */
  compterElementsDuGroupe: (
    acces: AccesAds,
    groupeId: string,
  ) => Promise<Lecture<Record<string, number>>>

  /**
   * Ce que le marché tape autour de quelques mots, et ce que ça coûterait.
   *
   * `marche` et `langue` sont les constantes de la plateforme, jamais devinées ici : une
   * fourchette de coût par clic n'a de sens que rapportée à un pays et à une langue, et
   * lire les volumes du monde entier pour une boutique suisse donnerait des chiffres vrais
   * et inutilisables.
   */
  ideesDeMotsCles: (
    acces: AccesAds,
    graines: string[],
    marche: string,
    langue: string,
  ) => Promise<Lecture<IdeeMotCle[]>>

  /**
   * Ce que la plateforme sait de mots-clés précis — ceux-là, et pas d'autres.
   *
   * Distinct des idées : un générateur d'idées n'a aucune obligation de chiffrer les mots
   * qu'on lui donne. Celui-ci répond sur la liste exacte, ce qui est indispensable dès
   * qu'on veut le prix d'une demande déjà constatée plutôt que d'une suggestion.
   */
  metriquesDeMotsCles: (
    acces: AccesAds,
    motsCles: string[],
    marche: string,
    langue: string,
  ) => Promise<Lecture<IdeeMotCle[]>>

  /**
   * Les mots-clés d'un contenant, relus à l'instant.
   *
   * Lus avant d'en déposer un : notre base a une semaine, et la plateforme refuse deux fois
   * le même mot dans la même correspondance. Un refus qui dit « le critère existe déjà »
   * n'aide personne ; le dire avant, si.
   */
  lireMotsClesDuGroupe: (
    acces: AccesAds,
    groupeId: string,
  ) => Promise<Lecture<Array<{ texte: string; correspondance: string }>>>

  /**
   * La langue que chaque campagne cible, par identifiant de campagne.
   *
   * Lue dans le ciblage, jamais devinée sur les mots : c'est la personne qui l'a posée.
   * Une campagne qui en cible plusieurs est absente du résultat — choisir pour elle serait
   * exactement la faute qu'on cherche à éviter.
   */
  lireLanguesDesCampagnes: (acces: AccesAds) => Promise<Lecture<Record<string, string>>>

  /**
   * Combien d'actions de conversion comptent réellement — activées **et** comptées.
   *
   * La nuance décide de tout : un compte peut porter cent actions activées mais secondaires,
   * restes d'un outil tiers, et n'avoir aucune vente comptée. Ne regarder que le statut
   * ferait croire que le suivi fonctionne, ce qui laisse dépenser à l'aveugle.
   */
  lireActionsConversion: (acces: AccesAds) => Promise<Lecture<number>>
}
