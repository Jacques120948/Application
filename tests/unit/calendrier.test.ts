import { describe, expect, it } from 'vitest'
import { dejaCouvert, langueDuChemin, planifier } from '@/server/audit/calendrier'
import type { Ligne } from '@/server/integrations/providers/google-search-console'

/**
 * L'ordre du calendrier de rédaction.
 *
 * C'est tout ce qui compte ici : un ordre faux fait écrire les mauvais articles pendant des
 * mois, et personne ne s'en aperçoit — les articles sont écrits, ils sont bons, ils ne
 * servent simplement à rien.
 */

const ligne = (cle: string, position: number, impressions: number, clics = 0): Ligne => ({
  cle,
  position,
  impressions,
  clics,
})

/** Un lundi, pour que les dates calculées soient vérifiables. */
const JEUDI = new Date('2026-09-17T12:00:00Z')

describe('le plan de rédaction', () => {
  it('met la deuxième page devant, même moins demandée', () => {
    /*
     * Une requête où le site sort onzième a déjà tout pour remonter ; une requête où il sort
     * centième part de zéro. Classer par affichages seuls mettrait la seconde devant.
     */
    const { creneaux } = planifier(
      [ligne('loin mais demandé', 78, 900), ligne('à portée', 14, 120)],
      [],
      { parPeriode: 1, periode: 'semaine', periodes: 4, depuis: JEUDI },
    )
    expect(creneaux.map((c) => c.requete)).toEqual(['à portée', 'loin mais demandé'])
  })

  it('écarte la première page : un article de plus n’y ajoute rien', () => {
    // Ce qui s'y joue, c'est le titre et la description. C'est le métier de Néo.
    const { creneaux } = planifier([ligne('déjà premier', 2.4, 5000)], [], {
      parPeriode: 1,
      periode: 'semaine' as const,
      periodes: 4,
      depuis: JEUDI,
    })
    expect(creneaux).toEqual([])
  })

  it('écarte ce qui est trop peu demandé pour porter un article', () => {
    expect(
      planifier([ligne('confidentiel', 15, 3)], [], {
        parPeriode: 1,
        periode: 'semaine',
        periodes: 4,
        depuis: JEUDI,
      }).creneaux,
    ).toEqual([])
  })

  it('ne repropose pas un sujet déjà écrit, et le dit', () => {
    const plan = planifier(
      [ligne('obsidienne noire vertus', 16, 300), ligne('quartz rose', 13, 200)],
      ['Obsidienne noire : origine, vertus et entretien de cette pierre volcanique'],
      { parPeriode: 1, periode: 'semaine', periodes: 4, depuis: JEUDI },
    )
    expect(plan.creneaux.map((c) => c.requete)).toEqual(['quartz rose'])
    expect(plan.ecartes).toBe(1)
  })

  it('étale sur les semaines, au rythme demandé', () => {
    const lignes = Array.from({ length: 6 }, (_, rang) =>
      ligne(`sujet ${rang}`, 12, 1000 - rang * 10),
    )
    const { creneaux } = planifier(lignes, [], { parPeriode: 2, periode: 'semaine', periodes: 3, depuis: JEUDI })
    expect(creneaux.map((c) => c.semaine)).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('ne propose jamais plus que ce que la période peut contenir', () => {
    const lignes = Array.from({ length: 50 }, (_, rang) => ligne(`sujet ${rang}`, 12, 500))
    const { creneaux } = planifier(lignes, [], { parPeriode: 1, periode: 'semaine', periodes: 8, depuis: JEUDI })
    expect(creneaux).toHaveLength(8)
  })

  it('date chaque créneau au lundi de sa semaine', () => {
    const { creneaux } = planifier([ligne('un sujet', 12, 300)], [], {
      parPeriode: 1,
      periode: 'semaine' as const,
      periodes: 1,
      depuis: JEUDI,
    })
    // Le 17 septembre 2026 est un jeudi : le lundi suivant est le 21.
    expect(creneaux[0]?.date.getDay()).toBe(1)
    expect(creneaux[0]?.date.getDate()).toBe(21)
  })

  it('n’annonce aucun gain, parce que personne ne le connaît', () => {
    /*
     * On pourrait multiplier les affichages par un taux de clic moyen et annoncer un nombre
     * de clics à gagner. Ce serait une invention présentée comme une prévision, sur un
     * produit dont l'argument est que ses chiffres sont mesurés.
     */
    const { creneaux } = planifier([ligne('une requête', 14, 300, 2)], [], {
      parPeriode: 1,
      periode: 'semaine' as const,
      periodes: 1,
      depuis: JEUDI,
    })
    const pourquoi = creneaux[0]?.pourquoi ?? ''
    expect(pourquoi).toContain('300 affichages')
    expect(pourquoi).not.toMatch(/gagner|rapporter|clics de plus|jusqu'à/i)
  })
})

describe('les sujets déjà traités', () => {
  it('reconnaît un article qui couvre la requête', () => {
    expect(
      dejaCouvert('obsidienne noire', ['Obsidienne noire : origine et vertus']),
    ).toBe(true)
  })

  it('ne confond pas deux sujets voisins', () => {
    expect(dejaCouvert('quartz rose vertus', ['Obsidienne noire : origine et vertus'])).toBe(
      false,
    )
  })

  it('ne couvre rien quand aucun article n’existe', () => {
    expect(dejaCouvert('bougie artisanale', [])).toBe(false)
  })
})

describe('la langue d’un sujet', () => {
  it('se lit dans le chemin de la page que Google classe', () => {
    /*
     * Mesurée, pas devinée. On pourrait chercher la langue de « avventurina verde » dans un
     * dictionnaire ; on regarde plutôt sur quelle page Google classe la requête, parce que
     * le chemin la porte et que c'est lui qui a tranché.
     */
    expect(langueDuChemin('https://cap-nature.ch/it/collections/pietre')).toBe('it')
    expect(langueDuChemin('https://cap-nature.ch/pt/')).toBe('pt')
  })

  it('ne prend pas une page ordinaire pour une langue', () => {
    expect(langueDuChemin('https://cap-nature.ch/collections/bougies')).toBeNull()
    expect(langueDuChemin('https://cap-nature.ch/')).toBeNull()
    // Deux lettres exactement : « fr-CH » est un chemin, pas un code de langue ici.
    expect(langueDuChemin('https://cap-nature.ch/fr-CH/bougies')).toBeNull()
  })

  it('porte la langue jusqu’au créneau, et se tait quand elle l’ignore', () => {
    const { creneaux } = planifier(
      [ligne('avventurina verde', 12, 365), ligne('jaspe rouge', 16, 848)],
      [],
      {
        parPeriode: 1,
        periode: 'semaine',
        periodes: 4,
        depuis: JEUDI,
        pages: new Map([['avventurina verde', 'https://cap-nature.ch/it/pietre']]),
      },
    )
    const parRequete = new Map(creneaux.map((c) => [c.requete, c.langue]))
    expect(parRequete.get('avventurina verde')).toBe('it')
    // Google n'a associé aucune page à celle-ci : on ne prétend pas connaître sa langue.
    expect(parRequete.get('jaspe rouge')).toBeNull()
  })
})

/** L'écart en jours entre deux créneaux, pour que les dates se vérifient sans arithmétique. */
function ecart(jours: readonly number[], a: number, b: number): number {
  return ((jours[b] ?? 0) - (jours[a] ?? 0)) / 86_400_000
}

describe('le rythme de publication', () => {
  const beaucoup = Array.from({ length: 20 }, (_, rang) => ligne(`sujet ${rang}`, 12, 900 - rang))

  it('espace les créneaux de quatre semaines quand on publie au mois', () => {
    const { creneaux } = planifier(beaucoup, [], {
      parPeriode: 1,
      periode: 'mois',
      periodes: 3,
      depuis: JEUDI,
    })
    expect(creneaux).toHaveLength(3)
    const jours = creneaux.map((c) => c.date.getTime())
    expect(ecart(jours, 0, 1)).toBe(28)
    expect(ecart(jours, 1, 2)).toBe(28)
  })

  it('propose autant de sujets que le rythme en demande', () => {
    // Deux par mois sur six mois : douze sujets, pas huit.
    const { creneaux } = planifier(beaucoup, [], {
      parPeriode: 2,
      periode: 'mois',
      periodes: 6,
      depuis: JEUDI,
    })
    expect(creneaux).toHaveLength(12)
    /*
     * Deux articles dans le même mois ne tombent pas le même jour : ils sont espacés de
     * deux semaines. Ils l'étaient, et c'est ce qui rendait la grille fausse — deux
     * articles empilés sur une case, le reste du mois vide. Personne n'écrit deux articles
     * le même jour puis plus rien pendant quatre semaines.
     */
    expect(ecart(creneaux.map((c) => c.date.getTime()), 0, 1)).toBe(14)
    // La période suivante commence bien quatre semaines après la précédente.
    expect(ecart(creneaux.map((c) => c.date.getTime()), 0, 2)).toBe(28)
  })

  /**
   * Le rythme hebdomadaire vu depuis la grille : trois articles par semaine occupent trois
   * cases distinctes, et toutes tombent dans la même semaine.
   */
  it('étale les articles d’une semaine sur des jours différents', () => {
    const { creneaux } = planifier(beaucoup, [], {
      parPeriode: 3,
      periode: 'semaine',
      periodes: 2,
      depuis: JEUDI,
    })
    const premiere = creneaux.slice(0, 3).map((c) => c.date.getDate())
    expect(new Set(premiere).size).toBe(3)
    // Lundi 21, mercredi 23, samedi 26 : trois jours de la même semaine.
    expect(premiere).toEqual([21, 23, 26])
  })

  it('garde les semaines collées quand on publie à la semaine', () => {
    const { creneaux } = planifier(beaucoup, [], {
      parPeriode: 1,
      periode: 'semaine',
      periodes: 3,
      depuis: JEUDI,
    })
    const jours = creneaux.map((c) => c.date.getTime())
    expect(ecart(jours, 0, 1)).toBe(7)
  })
})
