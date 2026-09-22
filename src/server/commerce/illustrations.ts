import type { VitrineShopify } from '@/server/integrations/providers/shopify'

/**
 * Le rapprochement entre ce qu'un article veut montrer et ce que la boutique vend.
 *
 * Milo ne produit jamais d'adresse d'image, et c'est la décision qui tient tout le reste.
 * Un modèle à qui l'on demande une URL en invente une : elle a la bonne forme, elle ne mène
 * nulle part, et l'article part chez le client avec des images cassées. Il écrit donc ce
 * qu'il voudrait voir — « une bougie avec une obsidienne » — et ce module va chercher la
 * fiche qui correspond. Une photo inventée devient impossible par construction, pas par
 * vigilance.
 *
 * Trois décisions.
 *
 * **Le rapprochement est bête, et c'est voulu.** Des mots en commun, pondérés par leur
 * rareté dans le catalogue. Pas d'appel à un modèle : ce serait un deuxième prix pour une
 * action qui n'en a qu'un, et une seconde occasion de se tromper sur une question qui se
 * tranche en comptant.
 *
 * **Mieux vaut aucune image qu'une mauvaise.** Un seuil écarte les rapprochements douteux.
 * Une section sans photo se lit très bien ; une section illustrée par le mauvais produit
 * fait douter de tout le texte, et c'est le genre d'erreur qu'un client repère avant nous.
 *
 * **Une fiche n'illustre qu'une section.** Le même produit répété cinq fois donne une
 * plaquette, pas un article — et l'article est justement ce qui doit valoir pour quelqu'un
 * qui ne connaît pas encore la boutique.
 */

/**
 * Ce qu'il faut de recouvrement pour oser illustrer.
 *
 * Exprimé en rareté cumulée, une quantité qui ne dépend pas de la taille du catalogue —
 * c'est tout l'intérêt. Une première version pondérait à la façon d'un moteur de recherche,
 * par le logarithme du nombre de fiches : elle marchait sur six cents fiches et ne
 * franchissait jamais le seuil sur six. Une petite boutique n'aurait jamais eu d'image, et
 * rien ne l'aurait expliqué.
 *
 * 0,5 revient à exiger qu'au moins un mot assez distinctif corresponde : un mot présent dans
 * la moitié des fiches ou moins suffit à lui seul, un mot banal ne suffit jamais.
 *
 * Pas plus haut, et la raison est arithmétique : sur N fiches, le mot le plus distinctif
 * possible — celui d'une seule fiche — vaut 1 − 1/N. Sur deux fiches, cela fait 0,5. Un
 * seuil au-dessus exclurait donc les tout petits catalogues par construction, quel que soit
 * ce qu'ils contiennent.
 */
const SEUIL = 0.5

/**
 * La part du souhait qui doit correspondre, et le nombre de mots en commun exigés.
 *
 * Le seuil de rareté seul ne suffisait pas, et le défaut est arrivé en production : un
 * article sur l'obsidienne noire s'est retrouvé illustré par une bandoulière de sac. Le
 * rapprochement s'était fait sur « noire » — assez rare dans le catalogue pour franchir le
 * seuil à elle seule — alors que « obsidienne », le mot qui définit le sujet, était absent.
 * Une couleur n'est pas un sujet, et aucun seuil absolu ne peut faire la différence : un
 * mot rare reste un mot rare, qu'il désigne la chose ou sa teinte.
 *
 * Deux exigences supplémentaires, et il faut les deux.
 *
 * **La part.** Ce qui correspond doit peser au moins la moitié de ce qui était demandé,
 * rareté comprise. Une fiche qui ne répond qu'à un mot sur trois ne répond pas au souhait,
 * si distinctif que soit ce mot.
 *
 * **Le nombre.** Au moins deux mots en commun dès que le souhait en contient deux que le
 * catalogue connaît. C'est un filet grossier, et il est là exprès : la part seule laisse
 * passer le cas où le mot accessoire est encore plus rare que le mot principal, et c'est
 * précisément la situation qui s'est produite. Un souhait d'un seul mot connu reste jugé
 * sur la rareté, faute de mieux.
 */
const PART_MINIMUM = 0.5
const MOTS_COMMUNS_MINIMUM = 2

/**
 * Les mots qu'on ne compte pas.
 *
 * Ils sont dans presque toutes les fiches et dans presque toutes les demandes : les garder
 * ferait correspondre n'importe quoi à n'importe quoi. La liste est courte à dessein — la
 * pondération par la rareté fait déjà le gros du travail, et un mot rangé ici par excès
 * serait un mot qu'on ne peut plus chercher.
 */
const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'et', 'ou', 'en', 'dans',
  'sur', 'avec', 'pour', 'par', 'sans', 'son', 'sa', 'ses', 'ce', 'cet', 'cette', 'qui',
  'que', 'photo', 'image', 'illustration', 'produit', 'article',
])

/** Minuscules, sans accents, sans ponctuation. Ce qui suit ne compare que des mots. */
export function normaliser(texte: string): string[] {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .split(' ')
    .filter((mot) => mot.length > 2 && !MOTS_VIDES.has(mot))
}

/**
 * La rareté d'un mot dans le catalogue, entre 0 et 1.
 *
 * « Bougie » chez un fabricant de bougies ne distingue rien ; « obsidienne » distingue une
 * fiche sur six cents. Sans cette pondération, une demande contenant « bougie » vaudrait
 * autant pour toutes les fiches, et la première l'emporterait — c'est-à-dire le hasard.
 *
 * La proportion plutôt qu'un logarithme : elle se lit sans calcul, et surtout elle vaut la
 * même chose sur six fiches et sur six cents, ce qui permet au seuil d'être un seuil.
 */
function rarete(mot: string, frequences: Map<string, number>, total: number): number {
  const vus = frequences.get(mot) ?? 0
  if (vus === 0) return 0
  return 1 - vus / total
}

export type Illustration = {
  /** L'index de la section illustrée. */
  section: number
  titre: string
  image: string
  alt: string
  lien: string | null
}

/**
 * Choisit une fiche par souhait, sans jamais réemployer la même.
 *
 * Les souhaits sont traités dans l'ordre des sections, et le meilleur rapprochement gagne.
 * Ce n'est pas l'attribution optimale au sens global — la calculer coûterait une complexité
 * qu'une poignée de sections ne justifie pas, et le résultat serait indiscernable.
 */
export function choisirIllustrations(
  souhaits: readonly (string | undefined)[],
  vitrine: readonly VitrineShopify[],
): Illustration[] {
  if (vitrine.length === 0) return []

  const mots = vitrine.map((piece) => normaliser(`${piece.titre} ${piece.alt}`))
  const frequences = new Map<string, number>()
  for (const liste of mots) {
    for (const mot of new Set(liste)) frequences.set(mot, (frequences.get(mot) ?? 0) + 1)
  }

  const pris = new Set<number>()
  const retenues: Illustration[] = []

  souhaits.forEach((souhait, section) => {
    if (souhait === undefined || souhait.trim() === '') return
    const cherches = new Set(normaliser(souhait))
    if (cherches.size === 0) return

    /*
     * Le poids total du souhait, et combien de ses mots le catalogue connaît.
     *
     * Un mot que la boutique n'emploie nulle part compte **plein**, et c'était la
     * correction décisive : on l'avait d'abord tenu pour neutre — il ne peut correspondre
     * à rien, donc il ne devait ni durcir ni adoucir le jugement. C'est faux. Un mot absent
     * du catalogue n'est pas une absence d'information, c'est l'information que la boutique
     * ne vend pas cette chose-là. « Une labradorite noire » dans une boutique sans
     * labradorite ne doit pas se rabattre sur ce qui est noir ; elle doit rester sans image.
     *
     * Le souhait est court par construction — le modèle reçoit pour consigne de le dire en
     * quelques mots du métier —, donc cette sévérité ne prive pas d'image les sections qui
     * en méritent une.
     */
    let poidsDemande = 0
    let motsConnus = 0
    for (const mot of cherches) {
      const poids = rarete(mot, frequences, vitrine.length)
      if (poids > 0) motsConnus += 1
      poidsDemande += poids === 0 ? 1 : poids
    }

    let meilleur = -1
    let note = 0
    let communs = 0
    mots.forEach((liste, rang) => {
      if (pris.has(rang)) return
      const presents = new Set(liste)
      let somme = 0
      let nombre = 0
      for (const mot of cherches) {
        if (!presents.has(mot)) continue
        const poids = rarete(mot, frequences, vitrine.length)
        if (poids > 0) nombre += 1
        somme += poids
      }
      if (somme > note) {
        note = somme
        communs = nombre
        meilleur = rang
      }
    })

    if (meilleur < 0 || note < SEUIL) return
    // Mieux vaut aucune image qu'une mauvaise : les deux garde-fous ci-dessous le disent.
    if (note / poidsDemande < PART_MINIMUM) return
    if (motsConnus >= MOTS_COMMUNS_MINIMUM && communs < MOTS_COMMUNS_MINIMUM) return
    const piece = vitrine[meilleur]
    if (piece === undefined) return

    pris.add(meilleur)
    retenues.push({
      section,
      titre: piece.titre,
      image: piece.image,
      /*
       * Le texte de remplacement du marchand quand il existe, le titre sinon : une image
       * sans alternative textuelle est précisément un des défauts que l'analyse reproche,
       * et il serait absurde d'en créer en illustrant.
       */
      alt: piece.alt.trim() === '' ? piece.titre : piece.alt,
      lien: piece.url,
    })
  })

  return retenues
}
