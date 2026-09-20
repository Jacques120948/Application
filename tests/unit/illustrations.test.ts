import { describe, expect, it } from 'vitest'
import { choisirIllustrations, normaliser } from '@/server/commerce/illustrations'
import type { VitrineShopify } from '@/server/integrations/providers/shopify'

/**
 * Le rapprochement entre ce qu'un article veut montrer et ce que la boutique vend.
 *
 * Milo ne produit jamais d'adresse d'image : il décrit la photo qu'il voudrait, et c'est ce
 * module qui va la chercher. Une image inventée devient impossible par construction. Ce qui
 * se vérifie ici, c'est le reste : qu'on trouve la bonne fiche, qu'on s'abstienne plutôt que
 * de se tromper, et qu'on ne répète pas le même produit cinq fois.
 */

function fiche(titre: string, extra: Partial<VitrineShopify> = {}): VitrineShopify {
  return {
    titre,
    handle: titre.toLowerCase().replace(/[^a-z]+/gu, '-'),
    url: `https://cap-nature.ch/products/${titre.toLowerCase().replace(/[^a-z]+/gu, '-')}`,
    image: `https://cdn.shopify.com/${titre.toLowerCase().replace(/[^a-z]+/gu, '-')}.jpg`,
    alt: '',
    ...extra,
  }
}

/** Un catalogue de bougies : le mot « bougie » n'y distingue donc rien. */
const VITRINE: VitrineShopify[] = [
  fiche('Bougie parfumée obsidienne noire'),
  fiche('Bougie parfumée améthyste'),
  fiche('Bougie parfumée quartz rose'),
  fiche('Bougie parfumée jade'),
  fiche('Coffret bougies découverte'),
  fiche('Diffuseur de parfum lavande'),
]

describe('la normalisation des mots', () => {
  it('retire les accents, la ponctuation et la casse', () => {
    expect(normaliser('Bougie parfumée à l’Obsidienne !')).toContain('obsidienne')
    expect(normaliser('Bougie PARFUMÉE')).toContain('parfumee')
  })

  it('écarte les mots qui ne distinguent rien', () => {
    expect(normaliser('une photo de la bougie')).toEqual(['bougie'])
  })
})

describe('le choix des illustrations', () => {
  it('trouve la fiche que la section décrit', () => {
    const [choix] = choisirIllustrations(['une bougie avec une obsidienne noire'], VITRINE)
    expect(choix?.titre).toBe('Bougie parfumée obsidienne noire')
    expect(choix?.section).toBe(0)
    expect(choix?.image).toContain('obsidienne')
  })

  it('ne se laisse pas décider par le mot que toutes les fiches portent', () => {
    /*
     * « Bougie » est dans cinq fiches sur six : il ne distingue rien, et sans pondération
     * par la rareté il ferait gagner la première venue — c'est-à-dire le hasard.
     */
    expect(choisirIllustrations(['une bougie'], VITRINE)).toEqual([])
  })

  it('s’abstient plutôt que d’illustrer de travers', () => {
    // Une section illustrée par le mauvais produit fait douter de tout le texte.
    expect(choisirIllustrations(['un volcan en éruption en Islande'], VITRINE)).toEqual([])
  })

  it('n’emploie jamais deux fois la même fiche', () => {
    const choix = choisirIllustrations(
      ['une bougie obsidienne', 'encore une obsidienne', 'une améthyste'],
      VITRINE,
    )
    const titres = choix.map((illustration) => illustration.titre)
    expect(new Set(titres).size).toBe(titres.length)
    expect(titres).toContain('Bougie parfumée améthyste')
  })

  it('garde l’index de la section, même quand certaines n’ont rien', () => {
    const choix = choisirIllustrations(
      [undefined, '   ', 'une bougie à l’améthyste'],
      VITRINE,
    )
    expect(choix).toHaveLength(1)
    expect(choix[0]?.section).toBe(2)
  })

  it('donne toujours un texte de remplacement, sinon il crée le défaut qu’il corrige', () => {
    const sansAlt = choisirIllustrations(['obsidienne noire'], VITRINE)
    expect(sansAlt[0]?.alt).toBe('Bougie parfumée obsidienne noire')

    const avecAlt = choisirIllustrations(
      ['obsidienne noire'],
      VITRINE.map((piece) =>
        piece.titre.includes('obsidienne')
          ? { ...piece, alt: 'Bougie noire sur un plateau de pierre' }
          : piece,
      ),
    )
    expect(avecAlt[0]?.alt).toBe('Bougie noire sur un plateau de pierre')
  })

  it('trouve aussi bien sur une petite boutique que sur une grande', () => {
    /*
     * La pondération ne doit pas dépendre du nombre de fiches. Une première version, tirée
     * des moteurs de recherche, ne franchissait jamais le seuil sur un petit catalogue :
     * une boutique de six produits n'aurait jamais eu d'image, sans que rien ne l'explique.
     */
    const petite = [fiche('Bougie obsidienne'), fiche('Bougie améthyste')]
    expect(choisirIllustrations(['obsidienne'], petite)[0]?.titre).toBe('Bougie obsidienne')

    const grande = [
      ...VITRINE,
      ...Array.from({ length: 300 }, (_, rang) => fiche(`Bougie parfumée numero ${rang}`)),
    ]
    expect(choisirIllustrations(['obsidienne'], grande)[0]?.titre).toBe(
      'Bougie parfumée obsidienne noire',
    )
  })

  it('ne rend rien quand la boutique n’est pas connectée', () => {
    expect(choisirIllustrations(['une bougie obsidienne'], [])).toEqual([])
  })
})
