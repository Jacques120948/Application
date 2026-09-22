/**
 * Deux sujets d'article se ressemblent-ils au point de faire doublon ?
 *
 * Le produit savait déjà répondre, mais à un seul endroit : le calendrier écarte un sujet
 * déjà couvert par un article existant. Ce garde-fou ne protégeait que les propositions.
 * Quelqu'un qui tape son sujet à la main n'était prévenu de rien, et trois articles sur
 * l'obsidienne noire ont été écrits le même jour — trois pages qui visent la même recherche,
 * se concurrencent entre elles, et dont Google n'en classera qu'une. C'est exactement le
 * contenu dupliqué que l'analyse reproche ensuite au site : Evoliia le produisait.
 *
 * Le calcul vit ici plutôt que dans un service parce que l'écran doit pouvoir prévenir
 * **avant** le clic, pendant que la personne tape, sans aller-retour et sans dépenser un
 * crédit — et parce qu'un calcul recopié des deux côtés finit toujours par diverger.
 *
 * Ce n'est pas exact, et ça n'a pas à l'être : le coût d'une erreur est un avertissement de
 * trop ou un avertissement manquant, jamais un article bloqué. Rien n'empêche d'écrire —
 * écrire deux fois sur un sujet est parfois voulu, pour un angle vraiment différent.
 */

/**
 * Les mots qu'on ne compte pas.
 *
 * Deux familles. Les mots de liaison, présents partout, qui feraient correspondre n'importe
 * quoi à n'importe quoi. Et les mots de forme — « guide », « comment », « choisir » — qui
 * disent la tournure de l'article et non son sujet : « comment choisir une améthyste » et
 * « comment choisir une bougie » partagent trois mots sur quatre sans parler de la même
 * chose, et c'est la façon la plus sûre de prévenir à tort.
 */
const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'et', 'ou', 'en', 'dans',
  'sur', 'avec', 'pour', 'par', 'sans', 'son', 'sa', 'ses', 'ce', 'cet', 'cette', 'qui',
  'que', 'quoi', 'est', 'sont', 'elle', 'elles', 'ils', 'vous', 'nous', 'plus', 'tout',
  'comment', 'pourquoi', 'quel', 'quelle', 'guide', 'article', 'blog', 'faut', 'savoir',
  'choisir', 'utiliser', 'avant', 'apres', 'bien', 'meilleur', 'meilleure',
])

/** Minuscules, sans accents, sans ponctuation. Ce qui suit ne compare que des mots. */
export function motsUtiles(texte: string): string[] {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .split(' ')
    .filter((mot) => mot.length > 2 && !MOTS_VIDES.has(mot))
}

/**
 * Ce qu'il faut de mots en commun pour parler de doublon, en proportion du sujet demandé.
 *
 * La même valeur que le calendrier emploie pour écarter un sujet déjà couvert : les deux
 * répondent à la même question, et deux seuils différents donneraient un écran qui prévient
 * là où l'autre se tait.
 */
export const SEUIL_PROCHE = 0.6

/**
 * En dessous de ce nombre de mots utiles, on ne se prononce pas.
 *
 * « Bougie » chez un fabricant de bougies correspond à tout son blog : prévenir à chaque
 * fois donnerait un avertissement permanent, et un avertissement permanent n'est plus un
 * avertissement — c'est un décor qu'on apprend à ne plus lire, y compris le jour où il a
 * raison.
 */
const MOTS_MINIMUM = 2

/**
 * La rareté de chaque mot dans un ensemble de textes, entre 0 et 1.
 *
 * Sans cette pondération, le rapprochement se trompe d'une façon très précise, et le test
 * l'a attrapée avant l'écran : « labradorite vertus origine » correspondait à l'article sur
 * l'améthyste, parce que deux mots sur trois — « vertus », « origine » — sont dans presque
 * tous les titres d'un blog de pierres. Le seul mot qui distinguait quoi que ce soit,
 * « labradorite », était absent, et c'est exactement lui qui décidait de la réponse.
 *
 * Un mot que rien ne contient vaut 1 : c'est le plus distinctif qui soit, et aucun article
 * ne peut alors faire doublon avec un sujet qui repose dessus. Un mot présent partout tend
 * vers 0 et cesse de peser.
 *
 * La proportion plutôt qu'un logarithme, comme ailleurs dans le produit : elle se lit sans
 * calcul, et elle vaut la même chose sur trois articles et sur trois cents — ce qui permet
 * au seuil d'être un seuil.
 *
 * Un plancher, enfin, et il n'est pas cosmétique : un mot présent dans **tous** les textes
 * vaudrait zéro, et un sujet dont tous les mots sont dans tous les textes ne pèserait plus
 * rien du tout — le rapprochement rendrait alors zéro et ne préviendrait jamais. Le cas
 * n'est pas théorique : il se produit dès le premier article, où chaque mot est par
 * construction présent partout.
 */
const PLANCHER = 0.1

export function raretes(corpus: readonly string[]): Map<string, number> {
  const total = corpus.length
  const compte = new Map<string, number>()
  for (const texte of corpus) {
    for (const mot of new Set(motsUtiles(texte))) {
      compte.set(mot, (compte.get(mot) ?? 0) + 1)
    }
  }
  const rarete = new Map<string, number>()
  if (total === 0) return rarete
  for (const [mot, fois] of compte) rarete.set(mot, Math.max(PLANCHER, 1 - fois / total))
  return rarete
}

/**
 * La part du sujet demandé que ce texte couvre, entre 0 et 1.
 *
 * Pondérée par la rareté quand on la lui donne : ce qui compte n'est pas combien de mots se
 * retrouvent, mais lesquels. Sans pondération — appel sans corpus — tous les mots pèsent
 * pareil, ce qui reste juste quand on compare deux textes isolés.
 */
export function recouvrement(
  sujet: string,
  texte: string,
  rarete?: ReadonlyMap<string, number>,
): number {
  const mots = motsUtiles(sujet)
  if (mots.length === 0) return 0
  const presents = new Set(motsUtiles(texte))
  // Un mot absent du corpus est le plus distinctif qui soit : il vaut son poids plein.
  const poids = (mot: string): number => rarete?.get(mot) ?? 1
  const total = mots.reduce((somme, mot) => somme + poids(mot), 0)
  if (total === 0) return 0
  const trouve = mots
    .filter((mot) => presents.has(mot))
    .reduce((somme, mot) => somme + poids(mot), 0)
  return trouve / total
}

/** Ce qu'il faut savoir d'un article pour juger s'il fait doublon. */
export type ArticleComparable = { id: string; sujet: string; titre: string }

/**
 * Les articles existants qui traitent déjà ce sujet, du plus proche au moins proche.
 *
 * On compare au sujet **et** au titre réunis : un article dont le titre a été reformulé —
 * « Obsidienne noire : ce qu'il faut savoir » — garde en mémoire la demande qui l'a produit,
 * et c'est souvent elle qui porte les mots de la recherche.
 */
export function sujetsProches<T extends ArticleComparable>(
  sujet: string,
  articles: readonly T[],
): T[] {
  if (motsUtiles(sujet).length < MOTS_MINIMUM) return []
  const textes = articles.map((article) => `${article.sujet} ${article.titre}`)
  const rarete = raretes(textes)
  return articles
    .map((article, index) => ({
      article,
      score: recouvrement(sujet, textes[index]!, rarete),
    }))
    .filter((entree) => entree.score >= SEUIL_PROCHE)
    .sort((a, b) => b.score - a.score)
    .map((entree) => entree.article)
}
