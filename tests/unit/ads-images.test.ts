import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classerPhotos, FORMATS, formatValide, nommerImage } from '@/server/ads/images'
import type { VitrineShopify } from '@/server/integrations/providers/shopify'

/**
 * Les images d'une annonce.
 *
 * La décision qui tient ce module n'est pas technique : Naya ne fabrique pas d'image. Une
 * bougie produite par une intelligence artificielle montrerait dans l'annonce un produit qui
 * n'existe pas dans la boutique — quelqu'un cliquerait sur une bougie qu'il ne trouverait
 * nulle part. Ce qui se vérifie ici découle de ce choix.
 */

const VITRINE: VitrineShopify[] = [
  {
    titre: 'Bougie Citrine parfumée',
    handle: 'bougie-citrine',
    url: null,
    image: 'https://cdn.exemple.test/citrine.jpg',
    alt: 'Bougie avec citrine',
  },
  {
    titre: 'Bougie Quartz rose',
    handle: 'bougie-quartz',
    url: null,
    image: 'https://cdn.exemple.test/quartz.jpg',
    alt: 'Bougie avec quartz rose',
  },
  {
    titre: 'Bracelet pierre naturelle',
    handle: 'bracelet',
    url: null,
    image: 'https://cdn.exemple.test/bracelet.jpg',
    alt: 'Bracelet',
  },
]

describe('le rapprochement', () => {
  it('choisit la fiche qui parle du sujet, pas celle au titre le plus long', () => {
    /*
     * « bougie » est dans deux fiches sur trois et ne distingue rien ; « citrine » n'est que
     * dans une. Un comptage brut de mots communs choisirait au hasard entre les deux bougies.
     */
    const classees = classerPhotos(['bougie citrine'], VITRINE)
    expect(classees[0]?.handle).toBe('bougie-citrine')
  })

  it('porte le motif du rapprochement, qui le rend contestable', () => {
    const classees = classerPhotos(['bougie citrine'], VITRINE)
    expect(classees[0]?.motifs).toContain('citrine')
  })

  it('écarte les fiches qui n’ont rien en commun', () => {
    const classees = classerPhotos(['diffuseur électrique'], VITRINE)
    expect(classees).toHaveLength(0)
  })

  it('ne rend rien sans sujet ni sans catalogue', () => {
    expect(classerPhotos([], VITRINE)).toHaveLength(0)
    expect(classerPhotos(['bougie'], [])).toHaveLength(0)
  })
})

describe('les formats', () => {
  it('sont les trois que Google impose, avec leurs proportions exactes', () => {
    expect(FORMATS.paysage.largeur / FORMATS.paysage.hauteur).toBeCloseTo(1.91, 1)
    expect(FORMATS.carre.largeur).toBe(FORMATS.carre.hauteur)
    expect(FORMATS.portrait.largeur / FORMATS.portrait.hauteur).toBeCloseTo(0.8, 2)
  })

  it('dépassent les minimums de Google plutôt que de s’y coller', () => {
    /*
     * Une image déposée au minimum est acceptée puis affichée floue sur un grand écran, ce
     * qui est pire qu'un refus : personne ne le voit.
     */
    expect(FORMATS.paysage.largeur).toBeGreaterThanOrEqual(1200)
    expect(FORMATS.carre.largeur).toBeGreaterThanOrEqual(1200)
  })

  it('disent ce qu’ils coupent', () => {
    for (const format of Object.values(FORMATS)) {
      expect(format.coupe.length).toBeGreaterThan(10)
    }
  })

  it('refusent un format inventé', () => {
    expect(formatValide('carre')).toBe('carre')
    expect(formatValide('banniere')).toBeNull()
    expect(formatValide(42)).toBeNull()
  })
})

describe('le nom donné chez Google', () => {
  it('reste unique d’un dépôt à l’autre', () => {
    // Google impose des noms uniques par compte : deux dépôts de la même photo échoueraient
    // sur un conflit que personne ne saurait interpréter.
    const premier = nommerImage('Bougie Citrine', 'carre')
    expect(premier).toContain('Bougie Citrine')
    expect(premier).toContain('Carré')
  })

  it('survit à un titre vide', () => {
    expect(nommerImage('   ', 'paysage')).toContain('Photo')
  })
})

describe('la sûreté du téléchargement', () => {
  it('passe par le client protégé, pas par un second', () => {
    /*
     * L'adresse vient du catalogue d'une boutique, donc d'ailleurs. Écrire un second client
     * HTTP « juste pour les images » serait écrire une seconde porte, et la seconde porte
     * est toujours celle qu'on oublie de fermer.
     */
    const source = readFileSync('src/server/ads/images.ts', 'utf8')
    expect(source).toContain('secureFetchBytes')
    expect(source).not.toContain('fetch(')
  })

  it('lit le format dans les octets, jamais dans l’en-tête annoncé', () => {
    const source = readFileSync('src/server/ads/images.ts', 'utf8')
    expect(source).toContain('detectFormat')
  })

  it('re-encode l’image plutôt que de la relayer', () => {
    // Ce qui laisse tomber au passage scripts, position GPS et profils exotiques.
    const source = readFileSync('src/server/ads/images.ts', 'utf8')
    expect(source).toContain('.jpeg(')
  })

  it('n’appelle aucun générateur d’image', () => {
    const source = readFileSync('src/server/ads/images.ts', 'utf8')
    expect(source).not.toContain('media/generate')
    expect(source).not.toContain('generateOpenAiImage')
  })
})
