import { describe, expect, it } from 'vitest'
import { tranches, TRANCHES_PAR_NIVEAU } from '@/server/ads/synchro-meta'

/**
 * Le découpage d'une fenêtre, et les deux façons de le rater.
 *
 * Meta facture une demande d'insights au produit « objets × jours ». Cinq cent soixante-neuf
 * annonces sur vingt-huit jours lui demandent d'agréger seize mille lignes avant de rendre
 * la première page — et il n'y arrive pas à temps. L'appel meurt sur son propre délai, et
 * l'écran annonce « Meta est momentanément injoignable » alors que Meta va très bien.
 *
 * Découper est donc nécessaire, et deux erreurs guettent. Une tranche qui déborde fait relire
 * deux fois la même journée : invisible, puisque l'écriture est un remplacement. Une tranche
 * qui saute un jour laisse un trou dans une courbe de dépense, et un trou se lit comme une
 * baisse. Ce fichier interdit les deux.
 */

/** Les jours effectivement couverts, à plat, pour vérifier qu'il n'en manque ni n'en double. */
function couverts(decoupe: Array<{ depuis: string; jusqua: string }>): string[] {
  const jours: string[] = []
  for (const tranche of decoupe) {
    for (
      let curseur = Date.parse(`${tranche.depuis}T00:00:00Z`);
      curseur <= Date.parse(`${tranche.jusqua}T00:00:00Z`);
      curseur += 24 * 60 * 60 * 1000
    ) {
      jours.push(new Date(curseur).toISOString().slice(0, 10))
    }
  }
  return jours
}

describe('le découpage d’une fenêtre', () => {
  it('couvre exactement la fenêtre, sans trou ni doublon', () => {
    const decoupe = tranches('2026-09-01', '2026-09-28', 7)
    const jours = couverts(decoupe)

    expect(jours).toHaveLength(28)
    expect(jours[0]).toBe('2026-09-01')
    expect(jours[27]).toBe('2026-09-28')
    expect(new Set(jours).size).toBe(28)
  })

  it('ne dépasse jamais la largeur annoncée, quel que soit l’étage', () => {
    for (const largeur of Object.values(TRANCHES_PAR_NIVEAU)) {
      for (const tranche of tranches('2026-06-01', '2026-08-29', largeur)) {
        const jours = couverts([tranche]).length
        expect(jours).toBeLessThanOrEqual(largeur)
        expect(jours).toBeGreaterThan(0)
      }
    }
  })

  it('laisse une fenêtre courte en une seule demande', () => {
    // Inutile de découper ce qui tient déjà : un appel de plus est un appel de plus.
    expect(tranches('2026-09-01', '2026-09-07', 7)).toEqual([
      { depuis: '2026-09-01', jusqua: '2026-09-07' },
    ])
  })

  it('tient sur une seule journée', () => {
    expect(tranches('2026-09-07', '2026-09-07', 7)).toEqual([
      { depuis: '2026-09-07', jusqua: '2026-09-07' },
    ])
  })

  it('rend la fenêtre telle quelle plutôt que rien, si elle est absurde', () => {
    /*
     * Une fenêtre inversée ou illisible ne doit pas faire disparaître la lecture en
     * silence : on la passe telle quelle et c'est Meta qui tranchera, avec son message.
     */
    expect(tranches('2026-09-28', '2026-09-01', 7)).toEqual([
      { depuis: '2026-09-28', jusqua: '2026-09-01' },
    ])
    expect(tranches('n’importe quoi', '2026-09-01', 7)).toHaveLength(1)
  })
})
