import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  mouvements,
  periodeValide,
  PERIODES_ORGANIQUE,
} from '@/server/audit/organique'
import {
  CourbeOrganique,
  regrouper,
  type JourOrganique,
} from '@/components/studio/CourbeOrganique'

/**
 * Le trafic naturel : le sens du gain, le regroupement, et le SVG qui casse en silence.
 *
 * Le premier de ces trois contrôles est le seul qui compte vraiment. Chez Google, une
 * position plus petite est meilleure ; un gain de places est donc une **diminution**. Écrire
 * la soustraction à l'envers afficherait chaque progrès comme un recul, et rien ne s'en
 * apercevrait : l'écran serait bien formé, les nombres plausibles, et la personne conclurait
 * qu'elle perd du terrain là où elle en gagne.
 */

function relevee(lignes: [string, number, number][]) {
  return lignes.map(([requete, position, impressions]) => ({ requete, position, impressions }))
}

describe('les mouvements de rang', () => {
  it('compte une montée comme un gain positif, pas comme une perte', () => {
    // De la place 18 à la place 4 : quatorze places gagnées.
    const bilan = mouvements(relevee([['bougie citrine', 18, 400]]), relevee([['bougie citrine', 4, 400]]))

    expect(bilan.gagnees).toHaveLength(1)
    expect(bilan.gagnees[0]?.gain).toBe(14)
    expect(bilan.gagnees[0]?.position).toBe(4)
    expect(bilan.gagnees[0]?.positionAvant).toBe(18)
    expect(bilan.perdues).toHaveLength(0)
  })

  it('compte une descente comme un gain négatif', () => {
    const bilan = mouvements(relevee([['bougie améthyste', 3, 300]]), relevee([['bougie améthyste', 11, 300]]))

    expect(bilan.perdues).toHaveLength(1)
    expect(bilan.perdues[0]?.gain).toBe(-8)
    expect(bilan.gagnees).toHaveLength(0)
  })

  it('ignore une requête trop peu vue : trois affichages ne font pas une tendance', () => {
    const bilan = mouvements(relevee([['bougie rare', 40, 3]]), relevee([['bougie rare', 2, 3]]))

    expect(bilan.gagnees).toHaveLength(0)
    expect(bilan.perdues).toHaveLength(0)
  })

  it('ignore la respiration ordinaire des classements', () => {
    const bilan = mouvements(relevee([['bougie', 8.4, 500]]), relevee([['bougie', 7.6, 500]]))

    expect(bilan.gagnees).toHaveLength(0)
  })

  it('ignore une requête neuve : sans point de départ, il n’y a pas de mouvement', () => {
    const bilan = mouvements(relevee([['ancienne', 10, 100]]), relevee([['nouvelle', 2, 100]]))

    expect(bilan.gagnees).toHaveLength(0)
    expect(bilan.perdues).toHaveLength(0)
  })

  it('trie les montées de la plus forte à la plus faible', () => {
    const avant = relevee([['a', 20, 100], ['b', 30, 100], ['c', 12, 100]])
    const apres = relevee([['a', 15, 100], ['b', 8, 100], ['c', 9, 100]])
    const bilan = mouvements(avant, apres)

    expect(bilan.gagnees.map((un) => un.requete)).toEqual(['b', 'a', 'c'])
  })

  it('survit à des relevés illisibles sans rien inventer', () => {
    expect(mouvements(null, undefined)).toEqual({ gagnees: [], perdues: [] })
    expect(mouvements('bruit', [{ requete: 42 }])).toEqual({ gagnees: [], perdues: [] })
  })
})

describe('la période demandée', () => {
  it('accepte les fenêtres proposées', () => {
    for (const periode of PERIODES_ORGANIQUE) expect(periodeValide(periode)).toBe(periode)
    expect(periodeValide('180')).toBe(180)
  })

  it('ramène tout le reste à la valeur par défaut, sans erreur', () => {
    // Le paramètre vient de l'adresse : il ne doit jamais atteindre Google tel quel.
    for (const bruit of [undefined, null, 'tous', -1, 99_999, '9999999']) {
      expect(PERIODES_ORGANIQUE).toContain(periodeValide(bruit))
    }
  })
})

function serie(nombre: number, clics: (index: number) => number): JourOrganique[] {
  return Array.from({ length: nombre }, (_, index) => {
    const debut = new Date(Date.UTC(2025, 0, 1) + index * 24 * 60 * 60 * 1000)
    return {
      jour: debut.toISOString().slice(0, 10),
      clics: clics(index),
      impressions: clics(index) * 20 + 5,
      position: 12,
    }
  })
}

describe('le regroupement par semaine', () => {
  it('additionne les clics et garde la fin intacte', () => {
    const paquets = regrouper(serie(14, () => 3), 7)

    expect(paquets).toHaveLength(2)
    expect(paquets[0]?.clics).toBe(21)
    expect(paquets[1]?.clics).toBe(21)
  })

  it('laisse le paquet incomplet du côté ancien, jamais du côté récent', () => {
    /*
     * Le dernier paquet est celui qu'on lit : amputé, il ferait finir la courbe sur une
     * chute qui n'existe pas. C'est le paquet le plus ancien qui doit être court.
     */
    const paquets = regrouper(serie(10, () => 1), 7)

    expect(paquets).toHaveLength(2)
    expect(paquets[0]?.clics).toBe(3)
    expect(paquets[1]?.clics).toBe(7)
  })

  it('pondère la position par les affichages, pas par les jours', () => {
    const jours: JourOrganique[] = [
      { jour: '2025-01-01', clics: 0, impressions: 1, position: 40 },
      { jour: '2025-01-02', clics: 0, impressions: 99, position: 8 },
    ]
    const paquets = regrouper(jours, 7)

    // Une moyenne simple donnerait 24 : la semaine plongerait sur un échantillon de rien.
    expect(paquets[0]?.position).toBeCloseTo(8.3, 1)
  })

  it('ne regroupe rien quand la taille vaut un', () => {
    expect(regrouper(serie(5, () => 1), 1)).toHaveLength(5)
  })
})

function rendre(jours: JourOrganique[]): string {
  return renderToStaticMarkup(createElement(CourbeOrganique, { serie: jours }))
}

describe('la courbe du trafic naturel', () => {
  it('ne produit aucune coordonnée invalide, quelle que soit la période', () => {
    for (const nombre of [2, 7, 28, 90, 180, 480]) {
      const html = rendre(serie(nombre, (index) => (index % 4 === 0 ? 0 : index % 17)))
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('Infinity')
      expect(html).toContain('<svg')
    }
  })

  it('survit à une seule journée qui compte, toutes les autres à zéro', () => {
    const jours = serie(30, () => 0).map((jour, index) =>
      index === 12 ? { ...jour, clics: 9, impressions: 300 } : { ...jour, impressions: 0 },
    )
    const html = rendre(jours)

    expect(html).not.toContain('NaN')
    expect(html).toContain('<svg')
  })

  it('le dit plutôt que de dessiner un cadre vide quand Google n’a rien affiché', () => {
    const html = rendre(serie(10, () => 0).map((jour) => ({ ...jour, impressions: 0 })))

    expect(html).not.toContain('<svg')
    expect(html).toContain('rien à tracer')
  })

  it('regroupe par semaine au-delà de quatre mois, et le dit', () => {
    expect(rendre(serie(480, () => 4))).toContain('Une barre par semaine')
    expect(rendre(serie(90, () => 4))).not.toContain('Une barre par semaine')
  })

  it('invite à revenir plus tard plutôt que de tracer une courbe d’un point', () => {
    const html = rendre(serie(1, () => 10))

    expect(html).not.toContain('<svg')
    expect(html).toContain('assez de jours')
  })

  it('nomme les deux échelles : un croisement de traits ne doit pas se lire', () => {
    const html = rendre(serie(30, (index) => index % 7))

    expect(html).toContain('Les deux échelles sont différentes')
  })
})
