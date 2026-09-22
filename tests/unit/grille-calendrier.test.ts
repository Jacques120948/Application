import { describe, expect, it } from 'vitest'
import {
  grilleDuMois,
  moisDisponibles,
  decalageDansLaPeriode,
  type ArticleEcrit,
  type Creneau,
} from '@/server/audit/calendrier'

/**
 * La grille d'un mois.
 *
 * Un calendrier est une affaire de découpage et de bornes : le mois qui commence un
 * dimanche, celui qui tient sur six lignes, le dernier jour qui déborde sur la semaine
 * suivante. Aucune de ces erreurs ne se voit sur une capture d'écran — on lit une grille
 * parfaitement plausible, avec un article posé sur la mauvaise case, ou disparu.
 */

function article(jour: string, titre = 'Un article'): ArticleEcrit {
  return { id: jour, titre, date: new Date(jour), mots: 700, depose: false }
}

function creneau(jour: string, requete = 'une requête'): Creneau {
  return {
    semaine: 1,
    langue: null,
    date: new Date(jour),
    requete,
    impressions: 100,
    clics: 2,
    position: 12,
    pourquoi: '',
    intention: 'comprendre',
  }
}

describe('la grille d’un mois', () => {
  it('commence toujours un lundi et finit un dimanche', () => {
    for (const mois of [new Date(2026, 0, 1), new Date(2026, 1, 1), new Date(2026, 10, 1)]) {
      const grille = grilleDuMois(mois, [], [])
      for (const semaine of grille) {
        expect(semaine).toHaveLength(7)
        expect(semaine[0]!.date.getDay()).toBe(1)
        expect(semaine[6]!.date.getDay()).toBe(0)
      }
    }
  })

  it('couvre le mois entier, premier et dernier jour compris', () => {
    // Novembre 2026 commence un dimanche : le cas qui déborde sur six lignes.
    const grille = grilleDuMois(new Date(2026, 10, 1), [], [])
    const jours = grille.flat().filter((case_) => case_.dansLeMois).map((case_) => case_.date.getDate())
    expect(jours[0]).toBe(1)
    expect(jours.at(-1)).toBe(30)
    expect(jours).toHaveLength(30)
  })

  it('montre les jours des mois voisins, mais les marque comme tels', () => {
    const grille = grilleDuMois(new Date(2026, 9, 1), [], [])
    const dehors = grille.flat().filter((case_) => !case_.dansLeMois)
    // Octobre 2026 commence un jeudi : lundi, mardi et mercredi viennent de septembre.
    expect(dehors.length).toBeGreaterThan(0)
    expect(dehors.every((case_) => case_.date.getMonth() !== 9)).toBe(true)
  })

  it('ne dépasse jamais six semaines', () => {
    for (let mois = 0; mois < 12; mois += 1) {
      expect(grilleDuMois(new Date(2026, mois, 1), [], []).length).toBeLessThanOrEqual(6)
    }
  })

  it('pose chaque article et chaque sujet sur son jour', () => {
    const grille = grilleDuMois(
      new Date(2026, 9, 1),
      [article('2026-10-05T09:00:00')],
      [creneau('2026-10-19T00:00:00', 'labradorite vertu')],
    )
    const cases = grille.flat()
    expect(cases.find((c) => c.date.getDate() === 5 && c.dansLeMois)?.ecrits).toHaveLength(1)
    expect(cases.find((c) => c.date.getDate() === 19 && c.dansLeMois)?.prevus[0]?.requete).toBe(
      'labradorite vertu',
    )
    // Et nulle part ailleurs : un article qui apparaît deux fois est pire qu'absent.
    expect(cases.filter((c) => c.ecrits.length > 0)).toHaveLength(1)
    expect(cases.filter((c) => c.prevus.length > 0)).toHaveLength(1)
  })

  it('ne fait pas entrer dans le mois ce qui appartient au mois voisin', () => {
    /*
     * Le 1er octobre 2026 est un jeudi : la première ligne montre le 28 septembre. Un
     * article du 28 septembre s'y affiche, mais la case reste hors du mois — sans quoi le
     * même article compterait deux fois en changeant de mois.
     */
    const grille = grilleDuMois(new Date(2026, 9, 1), [article('2026-09-28T09:00:00')], [])
    const case_ = grille.flat().find((c) => c.ecrits.length > 0)
    expect(case_?.dansLeMois).toBe(false)
    expect(case_?.date.getMonth()).toBe(8)
  })
})

describe('les mois qu’on peut ouvrir', () => {
  const maintenant = new Date(2026, 8, 22)

  it('contient toujours le mois courant, même vide', () => {
    expect(moisDisponibles([], [], maintenant)).toEqual(['2026-09'])
  })

  it('remonte au plus ancien article et descend au dernier sujet', () => {
    const mois = moisDisponibles(
      [article('2026-07-03T09:00:00')],
      [creneau('2026-11-16T00:00:00')],
      maintenant,
    )
    expect(mois[0]).toBe('2026-07')
    expect(mois.at(-1)).toBe('2026-11')
    expect(mois).toContain('2026-09')
  })

  it('ne propose aucun mois deux fois, et les rend dans l’ordre', () => {
    const mois = moisDisponibles(
      [article('2026-09-01T09:00:00', 'a'), article('2026-09-30T09:00:00', 'b')],
      [creneau('2026-10-05T00:00:00')],
      maintenant,
    )
    expect(mois).toEqual(['2026-09', '2026-10'])
  })
})

/**
 * L'étalement dans la période. C'est ce qui fait la différence entre trois articles
 * empilés sur le lundi et trois articles répartis sur la semaine.
 */
describe('l’étalement des articles d’une période', () => {
  it('ne décale rien quand il n’y a qu’un article', () => {
    expect(decalageDansLaPeriode(0, 1, 7)).toBe(0)
  })

  it('répartit trois articles sur lundi, mercredi et samedi', () => {
    expect([0, 1, 2].map((rang) => decalageDansLaPeriode(rang, 3, 7))).toEqual([0, 2, 5])
  })

  it('répartit deux articles mensuels à quinze jours d’écart', () => {
    expect([0, 1].map((rang) => decalageDansLaPeriode(rang, 2, 28))).toEqual([0, 14])
  })

  it('ne sort jamais de la période', () => {
    for (const parPeriode of [1, 2, 3]) {
      for (let rang = 0; rang < parPeriode; rang += 1) {
        expect(decalageDansLaPeriode(rang, parPeriode, 7)).toBeLessThan(7)
      }
    }
  })
})
