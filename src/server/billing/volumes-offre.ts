import type { ActionCost } from '@/server/billing/action-costs'

/**
 * Ce qu'une réserve de crédits permet de faire, en choses reconnaissables.
 *
 * « 600 crédits par mois » ne veut rien dire tant qu'on ne connaît pas le produit, et c'est
 * précisément la phrase que lit quelqu'un qui ne le connaît pas encore. On la lui demande
 * pourtant de comparer quatre offres entre elles, et le plus souvent avec un concurrent qui,
 * lui, annonce « 20 articles ». Le crédit est une unité juste — il suit la dépense réelle —
 * mais c'est une unité de facturation, pas une unité de décision.
 *
 * Trois règles pour que cette traduction reste honnête.
 *
 * **On divise par le haut de la fourchette, jamais par le bas.** Un article coûte 8 à 20
 * crédits ; annoncer 600 / 8 = 75 articles serait vrai dans le meilleur cas et faux dans
 * tous les autres. 600 / 20 = 30 est le nombre qu'on est sûr de tenir. Une promesse de
 * volume se tient par le bas ou ne se fait pas.
 *
 * **Le « ou » est dit, et il est dit en toutes lettres.** Trente articles *ou* cent vingt
 * foires aux questions, pas les deux : c'est la même réserve qui se dépense. Une liste de
 * nombres sans cette conjonction se lit comme un cumul, et l'écart entre ce qu'on a compris
 * et ce qu'on reçoit est exactement ce qui fait résilier.
 *
 * **Rien n'est écrit en dur.** Les fourchettes viennent du back-office : les volumes
 * annoncés suivent donc le prix réglé par l'exploitant, et il ne peut pas exister d'écran
 * qui promette vingt articles pendant qu'un autre en facture le double.
 */

export type Volume = {
  /** L'identifiant de l'action, pour les tests et pour un affichage sur mesure. */
  id: string
  /** Ce que la personne obtient, accordé au nombre : « 30 articles », « 1 article ». */
  label: string
  /** Combien, au pire. Toujours au moins 1 — une ligne à zéro n'est pas une ligne. */
  combien: number
}

/**
 * Les actions traduites en volumes, dans l'ordre où elles se disent.
 *
 * De la plus grosse à la plus petite, parce que c'est la plus grosse qui situe l'offre :
 * quelqu'un qui hésite compare des articles, pas des balises. Les identifiants sont nommés
 * plutôt que déduits d'un tri par prix — une action chère n'est pas forcément parlante, et
 * l'ordre d'une grille tarifaire est une décision, pas un calcul.
 *
 * Le nom est ici et non dans le catalogue des coûts, et c'est assumé : celui du catalogue
 * est un verbe — « Écrire un article » —, ce qui se lit bien devant un bouton et se lit mal
 * derrière un nombre. Conséquence acceptée : une action que l'exploitant ajouterait
 * n'apparaîtra pas en volume tant que personne ne lui aura donné un nom qui s'accorde. Mieux
 * vaut une ligne absente qu'une ligne qui dit « 30 Écrire un article ».
 */
const NOMS: readonly { id: string; un: string; plusieurs: string }[] = [
  { id: 'article', un: 'article', plusieurs: 'articles' },
  { id: 'page', un: 'page réécrite', plusieurs: 'pages réécrites' },
  { id: 'faq', un: 'foire aux questions', plusieurs: 'foires aux questions' },
  { id: 'meta', un: 'titre ou description', plusieurs: 'titres ou descriptions' },
]

export const VOLUMES_MONTRES: readonly string[] = NOMS.map((nom) => nom.id)

/** Combien de lignes au plus. Au-delà, ce n'est plus un repère, c'est un tableau. */
const LIGNES_MAX = 3

/**
 * Ce que cette réserve permet, action par action.
 *
 * Une action absente du catalogue est sautée sans bruit : l'exploitant a le droit de la
 * retirer, et une grille tarifaire n'a pas à tomber en panne pour autant.
 */
export function volumes(credits: number, couts: readonly ActionCost[]): Volume[] {
  if (credits <= 0) return []

  const trouves: Volume[] = []
  for (const nom of NOMS) {
    if (trouves.length >= LIGNES_MAX) break
    const cout = couts.find((candidat) => candidat.id === nom.id)
    // Une action gratuite ne se divise pas, et elle n'a rien à faire dans une réserve.
    if (cout === undefined || cout.max <= 0) continue
    const combien = Math.floor(credits / cout.max)
    if (combien < 1) continue
    trouves.push({ id: nom.id, label: combien === 1 ? nom.un : nom.plusieurs, combien })
  }
  return trouves
}

/**
 * La même chose en une phrase, prête à s'afficher sous une offre.
 *
 * Vide quand rien ne se traduit : une offre dont la réserve ne couvre aucune action
 * entière n'a rien à annoncer, et « 0 article » serait pire que le silence.
 *
 * « environ » et « au choix » sont dans la phrase et non dans le gabarit qui l'entoure :
 * une phrase déplacée d'un écran à l'autre emporte alors ses réserves avec elle, au lieu
 * de les perdre en route et de devenir une promesse.
 */
export function phraseVolumes(credits: number, couts: readonly ActionCost[]): string {
  const lignes = volumes(credits, couts)
  if (lignes.length === 0) return ''
  const bouts = lignes.map((ligne) => `${ligne.combien} ${ligne.label}`)
  const liste =
    bouts.length === 1 ? bouts[0]! : `${bouts.slice(0, -1).join(', ')} ou ${bouts.at(-1)!}`
  return lignes.length === 1
    ? `De quoi faire environ ${liste} par mois.`
    : `De quoi faire environ ${liste} par mois — au choix, pas les uns et les autres.`
}
