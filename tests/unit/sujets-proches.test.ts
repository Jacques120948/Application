import { describe, expect, it } from 'vitest'
import { motsUtiles, raretes, recouvrement, sujetsProches } from '@/lib/sujets-proches'

/**
 * Prévenir d'un doublon avant d'écrire.
 *
 * Le défaut d'origine est réel et daté : trois articles sur l'obsidienne noire écrits le
 * même jour, parce que le garde-fou ne protégeait que les propositions du calendrier et pas
 * les sujets tapés à la main. Trois pages qui visent la même recherche se concurrencent
 * entre elles, et c'est le contenu dupliqué que l'analyse reproche ensuite au site — Evoliia
 * le produisait elle-même.
 *
 * Le risque inverse est aussi grave et moins visible : un avertissement qui se déclenche
 * trop souvent devient un décor qu'on apprend à ne plus lire, y compris le jour où il a
 * raison. Les deux erreurs sont donc tenues ici.
 */

const ARTICLES = [
  {
    id: '1',
    sujet: 'obsidienne noire',
    titre: 'Obsidienne noire : origine, vertus et utilisation en bougie',
  },
  {
    id: '2',
    sujet: 'amethyste',
    titre: 'Améthyste : vertus, origine et comment la choisir',
  },
  {
    id: '3',
    sujet: 'bougie artisanale fabrication',
    titre: 'Comment est fabriquée une bougie artisanale coulée à la main',
  },
]

describe('les sujets déjà traités', () => {
  it('reconnaît le sujet qui a produit les trois obsidiennes', () => {
    const proches = sujetsProches('obsidienne noire vertus', ARTICLES)
    expect(proches.map((article) => article.id)).toEqual(['1'])
  })

  it('reconnaît un sujet écrit autrement, accents et ponctuation compris', () => {
    expect(sujetsProches('Obsidienne, noire — vertus', ARTICLES)).toHaveLength(1)
  })

  it('ne confond pas deux pierres différentes', () => {
    expect(sujetsProches('labradorite vertus origine', ARTICLES)).toEqual([])
  })

  /*
   * Le piège le plus coûteux : chez un fabricant de bougies, « bougie » correspond à tout
   * le blog. Prévenir à chaque fois donnerait un avertissement permanent — et un
   * avertissement permanent n'avertit plus de rien.
   */
  it('se tait devant un sujet d’un seul mot, si courant soit-il', () => {
    expect(sujetsProches('bougie', ARTICLES)).toEqual([])
    expect(sujetsProches('obsidienne', ARTICLES)).toEqual([])
  })

  it('se tait sur un sujet vide, qui veut dire « choisis pour moi »', () => {
    expect(sujetsProches('', ARTICLES)).toEqual([])
    expect(sujetsProches('   ', ARTICLES)).toEqual([])
  })

  /*
   * Les mots de forme disent la tournure de l'article, pas son sujet. « Comment choisir une
   * améthyste » et « comment choisir une bougie » partagent trois mots sur quatre sans
   * parler de la même chose.
   */
  it('ne se laisse pas tromper par les mots de forme', () => {
    expect(motsUtiles('comment bien choisir un guide')).toEqual([])
    expect(sujetsProches('comment choisir une labradorite', ARTICLES)).toEqual([])
  })

  it('rend les articles du plus proche au moins proche', () => {
    const articles = [
      { id: 'loin', sujet: 'obsidienne', titre: 'Obsidienne : petit mot' },
      {
        id: 'pres',
        sujet: 'obsidienne noire volcanique',
        titre: 'Obsidienne noire volcanique : tout savoir',
      },
    ]
    expect(sujetsProches('obsidienne noire volcanique', articles)[0]?.id).toBe('pres')
  })

  it('compare au sujet demandé autant qu’au titre publié', () => {
    /*
     * Un titre reformulé perd les mots de la recherche ; la demande d'origine les garde.
     * Ne comparer qu'au titre laisserait passer le doublon le plus fréquent — celui qu'on
     * a rebaptisé.
     */
    const articles = [
      { id: 'a', sujet: 'labradorite vertu pierre', titre: 'Une pierre aux reflets changeants' },
    ]
    expect(sujetsProches('labradorite vertu pierre', articles)).toHaveLength(1)
  })
})

describe('le recouvrement', () => {
  it('vaut un quand tous les mots du sujet sont présents', () => {
    expect(recouvrement('obsidienne noire', 'Obsidienne noire : origine et vertus')).toBe(1)
  })

  it('vaut zéro quand rien ne correspond', () => {
    expect(recouvrement('labradorite', 'Améthyste et quartz rose')).toBe(0)
  })

  it('se mesure sur le sujet demandé, pas sur le texte comparé', () => {
    // Un titre long ne dilue pas la correspondance : c'est bien le sujet qu'on couvre.
    expect(
      recouvrement('obsidienne noire', 'Obsidienne noire : origine, vertus, entretien, bougies'),
    ).toBe(1)
  })
})

/**
 * La pondération par la rareté.
 *
 * C'est elle qui distingue « deux mots en commun » de « le bon mot en commun », et elle a
 * été ajoutée après qu'un test ci-dessus l'a exigée : sans elle, « labradorite vertus
 * origine » correspondait à l'article sur l'améthyste, parce que « vertus » et « origine »
 * sont dans presque tous les titres d'un blog de pierres. Le seul mot qui distinguait
 * quelque chose était absent, et c'est exactement lui qui aurait dû décider.
 */
describe('la rareté des mots', () => {
  it('donne son poids plein à un mot que rien ne contient', () => {
    const rarete = raretes(['bougie parfumee', 'bougie artisanale'])
    expect(rarete.get('labradorite')).toBeUndefined()
    // Absent du corpus : le calcul lui donne 1, le plus distinctif qui soit.
    expect(recouvrement('labradorite', 'labradorite', rarete)).toBe(1)
  })

  it('fait cesser de peser un mot présent partout', () => {
    const rarete = raretes(['bougie parfumee', 'bougie artisanale', 'bougie coulee'])
    expect(rarete.get('bougie')!).toBeLessThan(rarete.get('parfumee')!)
  })

  /*
   * Le plancher. Sans lui, un mot présent dans tous les textes vaudrait zéro, un sujet
   * entièrement composé de tels mots ne pèserait plus rien, et le rapprochement rendrait
   * zéro — c'est-à-dire ne préviendrait jamais. Le cas se produit dès le premier article,
   * où chaque mot est par construction présent partout.
   */
  it('prévient encore quand il n’existe qu’un seul article', () => {
    const articles = [
      { id: 'a', sujet: 'obsidienne noire', titre: 'Obsidienne noire : vertus et origine' },
    ]
    expect(sujetsProches('obsidienne noire vertus', articles)).toHaveLength(1)
  })

  it('ne pondère rien quand on ne lui donne pas de corpus', () => {
    expect(recouvrement('obsidienne noire', 'obsidienne rouge')).toBe(0.5)
  })
})
