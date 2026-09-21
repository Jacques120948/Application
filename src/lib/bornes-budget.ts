/**
 * De combien un budget publicitaire peut bouger d'un seul coup.
 *
 * Ces deux nombres vivent ici, sans aucune dépendance, parce qu'ils sont lus des deux côtés :
 * le serveur refuse ce qui les dépasse, et l'écran les affiche avant la frappe. Un champ qui
 * accepterait ce que le serveur refuse — ou l'inverse — ferait de ces bornes une devinette,
 * et ferait perdre le geste et la confiance. Les redéclarer dans le composant créerait deux
 * vérités, et le jour où l'une changerait, l'écran annoncerait une limite que le serveur ne
 * reconnaîtrait pas.
 *
 * Le reste des garde-fous — le mode du compte, le plafond mensuel, le nombre de gestes par
 * jour, le refus d'un budget partagé — reste côté serveur : ce sont des décisions, pas des
 * bornes de saisie, et le navigateur n'a pas à les connaître pour les subir.
 */

/** La baisse maximale d'un coup : on ne divise pas un budget par plus de deux. */
export const FACTEUR_MIN = 0.5

/** La hausse maximale d'un coup : on n'augmente pas de plus de moitié. */
export const FACTEUR_MAX = 1.5
