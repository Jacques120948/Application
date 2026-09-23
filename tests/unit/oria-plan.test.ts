import { describe, expect, it } from 'vitest'
import { OBJECTIFS, biaisDesObjectifs } from '@/lib/objectifs'
import { PLAFONDS, construirePlan, maSemaine } from '@/server/oria/plan-marketing'
import { POIDS_DEFAUT, classer, type Signal } from '@/server/oria/signaux'

/**
 * Le plan d'Oria et les objectifs qui l'inclinent.
 *
 * Trois propriétés, et chacune répond à une façon de rendre un plan inutilisable.
 *
 * **On ne remplit pas.** Un plan qui invente des tâches pour que chaque jour ait la sienne
 * apprend à ne plus le lire.
 *
 * **Le moment suit l'effort.** Ce qui demande de produire quelque chose ne va pas
 * « aujourd'hui », même bien classé.
 *
 * **Un objectif incline, il ne renverse pas.** Une panne reste devant, quoi qu'on cherche.
 */

function signal(partiel: Partial<Signal> & { cle: string }): Signal {
  return {
    sources: ['seo'],
    titre: partiel.cle,
    pourquoi: '',
    quoiFaire: '',
    mesure: '',
    impact: 'moyen',
    effort: 'moyen',
    urgence: 'important',
    confiance: 'elevee',
    href: '/fr/visibilite',
    ...partiel,
  }
}

describe('le plan', () => {
  it('ne remplit rien quand il n’y a rien', () => {
    const plan = construirePlan([])
    expect(plan).toEqual({ aujourdhui: [], semaine: [], mois: [] })
    expect(maSemaine(plan)).toEqual([])
  })

  it('met ce qui brûle aujourd’hui, quel que soit l’effort', () => {
    const plan = construirePlan([
      signal({ cle: 'rapide', effort: 'faible' }),
      signal({ cle: 'panne', urgence: 'critique', effort: 'eleve' }),
    ])
    expect(plan.aujourdhui.map((un) => un.signal.cle)).toEqual(['panne'])
  })

  it('choisit pour aujourd’hui ce qui se règle vite quand rien ne brûle', () => {
    const plan = construirePlan([
      signal({ cle: 'lourd', effort: 'eleve' }),
      signal({ cle: 'rapide', effort: 'faible' }),
    ])
    expect(plan.aujourdhui.map((un) => un.signal.cle)).toEqual(['rapide'])
  })

  it('ne va pas chercher pour aujourd’hui une correction rapide mais secondaire', () => {
    const plan = construirePlan([
      signal({ cle: 'premiere', effort: 'moyen' }),
      signal({ cle: 'deuxieme', effort: 'moyen' }),
      signal({ cle: 'troisieme', effort: 'eleve' }),
      signal({ cle: 'sixieme-rapide', effort: 'faible' }),
    ])
    expect(plan.aujourdhui.map((un) => un.signal.cle)).toEqual(['premiere'])
  })

  it('renvoie au mois ce qui demande de produire quelque chose', () => {
    const plan = construirePlan([
      signal({ cle: 'rapide', effort: 'faible' }),
      signal({ cle: 'lourd', effort: 'eleve' }),
      signal({ cle: 'moyen', effort: 'moyen' }),
    ])
    expect(plan.semaine.map((un) => un.signal.cle)).toEqual(['moyen'])
    expect(plan.mois.map((un) => un.signal.cle)).toEqual(['lourd'])
  })

  it('ne propose jamais deux fois la même action', () => {
    const signaux = Array.from({ length: 12 }, (_, i) =>
      signal({ cle: `s${i}`, effort: i % 3 === 0 ? 'eleve' : 'faible', urgence: i === 4 ? 'critique' : 'important' }),
    )
    const plan = construirePlan(signaux)
    const cles = [...plan.aujourdhui, ...plan.semaine, ...plan.mois].map((un) => un.signal.cle)
    expect(new Set(cles).size).toBe(cles.length)
  })

  it('respecte ses plafonds', () => {
    const signaux = Array.from({ length: 20 }, (_, i) =>
      signal({ cle: `s${i}`, urgence: 'critique', effort: 'faible' }),
    )
    const plan = construirePlan(signaux)
    expect(plan.aujourdhui.length).toBeLessThanOrEqual(PLAFONDS.aujourdhui)
    expect(plan.semaine.length).toBeLessThanOrEqual(PLAFONDS.semaine)
    expect(plan.mois.length).toBeLessThanOrEqual(PLAFONDS.mois)
  })

  it('confie chaque action à la personne, aidée de celui qui l’a relevée', () => {
    const plan = construirePlan([signal({ cle: 'x', sources: ['cro', 'meta'] })])
    const [premiere] = plan.aujourdhui
    expect(premiere?.responsable).toEqual({ type: 'utilisateur' })
    expect(premiere?.aide).toEqual(['cro', 'meta'])
  })
})

describe('ma semaine', () => {
  it('n’affiche que les jours qui ont quelque chose', () => {
    const jours = maSemaine(construirePlan([signal({ cle: 'seul', effort: 'faible' })]))
    expect(jours.map((un) => un.jour)).toEqual(['Lundi'])
  })

  it('répartit au lieu de tout poser le lundi', () => {
    const jours = maSemaine(
      construirePlan([
        signal({ cle: 'a', effort: 'faible' }),
        signal({ cle: 'b', effort: 'faible' }),
        signal({ cle: 'c', effort: 'moyen' }),
      ]),
    )
    expect(jours.length).toBe(3)
    expect(jours[0]?.jour).toBe('Lundi')
    expect(jours.every((un) => un.actions.length === 1)).toBe(true)
  })
})

describe('les objectifs', () => {
  it('ne proposent à la sélection que ce qu’un agent sait servir', () => {
    for (const un of OBJECTIFS) {
      if (un.indisponible === '') expect(un.agents.length, un.id).toBeGreaterThan(0)
      else expect(un.agents, un.id).toEqual([])
    }
  })

  it('pèsent davantage pour le premier que pour le second', () => {
    const biais = biaisDesObjectifs(['trafic-seo', 'visibilite-ia'])
    expect(biais.seo).toBe(2)
    expect(biais.geo).toBe(1.5)
    // Milo sert les deux : il garde le plus fort, sans cumul.
    expect(biais.content).toBe(2)
  })

  it('ignorent un objectif inconnu ou encore indisponible', () => {
    expect(biaisDesObjectifs(['inconnu', 'reseaux-sociaux'])).toEqual({})
  })

  it('font remonter les constats de l’objectif sans enterrer une panne', () => {
    const conversion = signal({ cle: 'conversion', sources: ['cro'] })
    const referencement = signal({ cle: 'referencement', sources: ['seo'] })
    const panne = signal({ cle: 'panne', sources: ['audit'], urgence: 'critique', impact: 'eleve' })

    const neutre = classer([referencement, conversion], POIDS_DEFAUT).map((un) => un.cle)
    expect(neutre).toEqual(['conversion', 'referencement'])

    const pourLeTrafic = classer([conversion, referencement, panne], POIDS_DEFAUT, biaisDesObjectifs(['trafic-seo']))
    expect(pourLeTrafic.map((un) => un.cle)).toEqual(['panne', 'referencement', 'conversion'])
  })
})
