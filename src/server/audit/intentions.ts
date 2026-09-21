/**
 * L'intention derrière une recherche.
 *
 * Search Console ne la donne pas : il rend des mots tapés, des affichages et une position,
 * et rien qui dise ce que la personne voulait. Pourtant « jaspe rouge vertus » et « acheter
 * jaspe rouge » n'appellent pas le même texte — l'un veut un guide, l'autre veut une fiche.
 * Écrire le même article pour les deux, c'est en rater un.
 *
 * Trois décisions.
 *
 * **Aucun appel à un modèle.** Classer douze requêtes coûterait un appel de plus à chaque
 * article, pour mille utilisateurs, sur une donnée qui tient dans une liste de mots. Une
 * règle écrite ici est gratuite, instantanée, et se relit : quelqu'un qui conteste une
 * étiquette peut voir exactement ce qui l'a produite.
 *
 * **Quatre langues.** Une boutique suisse reçoit du français, de l'allemand, de l'italien et
 * de l'anglais — les chiffres de Cap-Nature le montrent. Ne reconnaître que le français
 * rangerait « comprare diaspro rosso » en information, et lui ferait écrire un guide.
 *
 * **Le doute va vers l'information.** C'est le repli le moins coûteux : un guide écrit pour
 * une intention d'achat reste lisible et se classe, là où une page de vente servie à
 * quelqu'un qui cherchait à comprendre le fait partir. On n'étiquette donc que ce qui porte
 * un marqueur franc, et le reste est de l'information.
 */

export type Intention = 'achat' | 'comparaison' | 'local' | 'information'

/** Ce que chaque intention veut dire, en une phrase, pour l'écran comme pour le modèle. */
export const INTENTIONS: Record<Intention, string> = {
  achat: 'Prêt à acheter',
  comparaison: 'Compare avant de choisir',
  local: 'Cherche près de chez lui',
  information: 'Veut comprendre',
}

/**
 * Les marqueurs, en quatre langues.
 *
 * Des mots entiers, jamais des fragments : « or » anglais est un comparatif, et se retrouve
 * dans « original », « corail », « décoration ». La reconnaissance se fait donc sur des
 * mots découpés, et les fragments dangereux sont simplement absents de ces listes.
 */
const ACHAT = [
  // français
  'acheter', 'achat', 'commander', 'commande', 'prix', 'tarif', 'tarifs', 'cher', 'vendre',
  'vente', 'boutique', 'magasin', 'livraison', 'promo', 'promotion', 'soldes', 'coffret',
  // allemand
  'kaufen', 'preis', 'preise', 'bestellen', 'günstig', 'gunstig', 'versand', 'shop',
  // italien
  'comprare', 'acquistare', 'acquisto', 'prezzo', 'prezzi', 'vendita', 'negozio', 'spedizione',
  // anglais
  'buy', 'price', 'cheap', 'order', 'shipping', 'sale',
]

const COMPARAISON = [
  'vs', 'versus', 'comparatif', 'comparaison', 'comparer', 'différence', 'difference',
  'différences', 'differences', 'meilleur', 'meilleure', 'meilleurs', 'meilleures',
  'alternative', 'alternatives', 'avis',
  'vergleich', 'unterschied', 'beste', 'bester', 'testsieger',
  'differenza', 'differenze', 'migliore', 'migliori', 'confronto', 'recensioni',
  'best', 'compare', 'comparison', 'difference', 'review', 'reviews',
]

const LOCAL = [
  'suisse', 'romandie', 'genève', 'geneve', 'lausanne', 'neuchâtel', 'neuchatel', 'fribourg',
  'valais', 'vaud', 'sion', 'sierre', 'martigny', 'montreux', 'vevey', 'yverdon', 'nyon',
  'morges', 'bulle', 'delémont', 'delemont', 'jura', 'berne', 'bienne',
  'schweiz', 'svizzera', 'switzerland', 'zurich', 'zürich', 'basel', 'bern',
  'proche', 'près', 'pres', 'autour', 'nähe', 'nahe', 'vicino', 'near', 'nearby',
]

/** Les mots d'une requête, en minuscules et sans ponctuation. */
function mots(requete: string): string[] {
  return requete
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((mot) => mot !== '')
}

function porte(presents: ReadonlySet<string>, marqueurs: readonly string[]): boolean {
  return marqueurs.some((marqueur) => presents.has(marqueur))
}

/**
 * Les marqueurs de quelqu'un qui veut comprendre, et non acheter.
 *
 * Une liste à part, et c'est une distinction qui a coûté un vrai défaut. `classer` range en
 * « information » tout ce qui ne porte aucun marqueur : c'est le bon repli pour choisir un
 * sujet d'article, où le doute ne coûte qu'un guide un peu large. Appliqué à l'achat de
 * mots-clés, ce même repli étiquetait « bougie citrine » et « quartz rose » — des requêtes
 * produit parfaitement légitimes — comme « ces gens ne veulent pas acheter ». Faux, et
 * l'avertissement serait devenu du bruit qu'on apprend à ignorer.
 *
 * Ici, on n'affirme donc que ce qu'on voit : « vertus », « proprietà », « bedeutung ». Une
 * requête sans marqueur ne dit rien de son intention, et on se tait.
 */
const INFORMATION = [
  // français
  'vertus', 'vertu', 'propriétés', 'proprietes', 'bienfaits', 'bienfait', 'signification',
  'symbolique', 'symbole', 'comment', 'pourquoi', 'définition', 'definition', 'histoire',
  'origine', 'origines', 'utilisation', 'recette', 'guide', 'lithothérapie', 'lithotherapie',
  // allemand
  'bedeutung', 'wirkung', 'wirkungen', 'eigenschaften', 'anleitung', 'geschichte', 'warum',
  'herkunft',
  // italien
  'proprietà', 'proprieta', 'significato', 'benefici', 'beneficio', 'perché', 'perche',
  'storia', 'guida', 'origini',
  // anglais
  'meaning', 'benefits', 'properties', 'guide', 'history', 'origin', 'healing',
]

/**
 * Vrai quand la requête dit explicitement qu'on cherche à comprendre.
 *
 * Distincte de `classer`, qui doit toujours trancher : celle-ci a le droit de ne rien dire.
 * C'est ce qui la rend utilisable avant une dépense — elle ne signale que ce qu'elle voit,
 * et un signal rare est un signal qu'on lit.
 */
export function chercheASavoir(requete: string): boolean {
  return porte(new Set(mots(requete)), INFORMATION)
}

/**
 * L'intention d'une recherche.
 *
 * L'ordre des questions est l'ordre des conséquences. Une requête qui dit « acheter » a
 * décidé, quoi qu'elle dise par ailleurs — c'est le texte le plus près de la vente qu'il
 * faut lui servir. Vient ensuite la comparaison, qui décide encore. Le lieu ne passe
 * qu'après : « acheter du jaspe à Genève » est d'abord un achat, et la page qui le sert
 * mentionnera le lieu sans être une page de lieu.
 */
export function classer(requete: string): Intention {
  const presents = new Set(mots(requete))
  if (porte(presents, ACHAT)) return 'achat'
  if (porte(presents, COMPARAISON)) return 'comparaison'
  if (porte(presents, LOCAL)) return 'local'
  return 'information'
}
