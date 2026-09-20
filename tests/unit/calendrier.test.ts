import { describe, expect, it } from 'vitest'
import { dejaCouvert, planifier } from '@/server/audit/calendrier'
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
      { parSemaine: 1, semaines: 4, depuis: JEUDI },
    )
    expect(creneaux.map((c) => c.requete)).toEqual(['à portée', 'loin mais demandé'])
  })

  it('écarte la première page : un article de plus n’y ajoute rien', () => {
    // Ce qui s'y joue, c'est le titre et la description. C'est le métier de Néo.
    const { creneaux } = planifier([ligne('déjà premier', 2.4, 5000)], [], {
      parSemaine: 1,
      semaines: 4,
      depuis: JEUDI,
    })
    expect(creneaux).toEqual([])
  })

  it('écarte ce qui est trop peu demandé pour porter un article', () => {
    expect(
      planifier([ligne('confidentiel', 15, 3)], [], {
        parSemaine: 1,
        semaines: 4,
        depuis: JEUDI,
      }).creneaux,
    ).toEqual([])
  })

  it('ne repropose pas un sujet déjà écrit, et le dit', () => {
    const plan = planifier(
      [ligne('obsidienne noire vertus', 16, 300), ligne('quartz rose', 13, 200)],
      ['Obsidienne noire : origine, vertus et entretien de cette pierre volcanique'],
      { parSemaine: 1, semaines: 4, depuis: JEUDI },
    )
    expect(plan.creneaux.map((c) => c.requete)).toEqual(['quartz rose'])
    expect(plan.ecartes).toBe(1)
  })

  it('étale sur les semaines, au rythme demandé', () => {
    const lignes = Array.from({ length: 6 }, (_, rang) =>
      ligne(`sujet ${rang}`, 12, 1000 - rang * 10),
    )
    const { creneaux } = planifier(lignes, [], { parSemaine: 2, semaines: 3, depuis: JEUDI })
    expect(creneaux.map((c) => c.semaine)).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('ne propose jamais plus que ce que la période peut contenir', () => {
    const lignes = Array.from({ length: 50 }, (_, rang) => ligne(`sujet ${rang}`, 12, 500))
    const { creneaux } = planifier(lignes, [], { parSemaine: 1, semaines: 8, depuis: JEUDI })
    expect(creneaux).toHaveLength(8)
  })

  it('date chaque créneau au lundi de sa semaine', () => {
    const { creneaux } = planifier([ligne('un sujet', 12, 300)], [], {
      parSemaine: 1,
      semaines: 1,
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
      parSemaine: 1,
      semaines: 1,
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
