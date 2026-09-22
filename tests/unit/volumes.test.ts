import { describe, expect, it } from 'vitest'
import {
  aRafraichir,
  normaliser,
  parLangue,
  VOLUME_FRAIS_JOURS,
  type VolumeConnu,
} from '@/server/audit/volumes'

/**
 * Le volume de recherche : la forme du cache, sa fraîcheur, et le groupement par langue.
 *
 * Les trois endroits où ce module peut se tromper sans rien casser visiblement. Un cache qui
 * range « Bougie Citrine » et relit « bougie citrine » ne trouve jamais rien : il redemande
 * tout à chaque fois, et personne ne s'en aperçoit sinon par un quota qui s'épuise. Un
 * groupement de langue à l'envers rend des nombres vrais qui décrivent une autre demande —
 * le pire des échecs, celui qui a l'air d'un résultat.
 */

describe('la forme sous laquelle un mot est rangé', () => {
  it('est la même à l’écriture et à la relecture', () => {
    // Google rend « Bougie Citrine », Search Console rend « bougie citrine ».
    expect(normaliser('Bougie Citrine')).toBe(normaliser('bougie citrine'))
  })

  it('réduit les espaces plutôt que de créer deux lignes pour un mot', () => {
    expect(normaliser('  bougie   citrine ')).toBe('bougie citrine')
  })

  it('laisse les accents : « bougie améthyste » n’est pas « bougie amethyste »', () => {
    /*
     * Deux recherches distinctes chez Google, avec des volumes distincts. Les confondre
     * afficherait le volume de l'une sous l'autre.
     */
    expect(normaliser('Bougie Améthyste')).toBe('bougie améthyste')
  })
})

function connu(jours: number): VolumeConnu {
  return {
    volume: 500,
    concurrence: 'LOW',
    coutBasMicros: 0,
    coutHautMicros: 0,
    releveAt: new Date(Date.now() - jours * 24 * 60 * 60 * 1000),
  }
}

describe('la fraîcheur', () => {
  it('demande un relevé quand rien n’a jamais été chiffré', () => {
    expect(aRafraichir(new Map())).toBe(true)
  })

  it('ne redemande rien tant qu’une valeur est encore fraîche', () => {
    expect(aRafraichir(new Map([['bougie', connu(3)]]))).toBe(false)
  })

  it('redemande quand tout a passé le mois', () => {
    expect(aRafraichir(new Map([['bougie', connu(VOLUME_FRAIS_JOURS + 1)]]))).toBe(true)
  })

  it('une seule valeur fraîche suffit : on ne rappelle pas Google pour un reliquat', () => {
    const table = new Map([
      ['vieux', connu(200)],
      ['récent', connu(1)],
    ])
    expect(aRafraichir(table)).toBe(false)
  })
})

describe('le groupement par langue', () => {
  it('envoie chaque mot dans la langue que Google lui associe', () => {
    const groupes = parLangue(
      ['bougie citrine', 'diaspro rosso', 'kerze amethyst'],
      { 'bougie citrine': 'fr', 'diaspro rosso': 'it', 'kerze amethyst': 'de' },
      'fr',
    )

    expect(groupes.get('fr')).toEqual(['bougie citrine'])
    expect(groupes.get('it')).toEqual(['diaspro rosso'])
    expect(groupes.get('de')).toEqual(['kerze amethyst'])
  })

  it('rattache une langue inconnue à celle du site plutôt que d’écarter le mot', () => {
    /*
     * Le croisement requête/page ne couvre pas toutes les lignes : une requête sans langue
     * connue est un état ordinaire, pas une anomalie.
     */
    const groupes = parLangue(['bougie'], {}, 'fr')

    expect(groupes.get('fr')).toEqual(['bougie'])
  })

  it('refuse une langue que Google ne sait pas chiffrer', () => {
    const groupes = parLangue(['bougie'], { bougie: 'zz' }, 'de')

    expect(groupes.get('de')).toEqual(['bougie'])
    expect(groupes.has('zz')).toBe(false)
  })

  it('ne perd aucun mot en route', () => {
    const mots = ['un', 'deux', 'trois', 'quatre']
    const groupes = parLangue(mots, { un: 'it', deux: 'de' }, 'fr')
    const total = [...groupes.values()].reduce((somme, liste) => somme + liste.length, 0)

    expect(total).toBe(mots.length)
  })
})
