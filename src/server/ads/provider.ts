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
}
