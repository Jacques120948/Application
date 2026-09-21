import { describe, expect, it } from 'vitest'
import { AGENTS, AGENT_IDS, findAgent, TEAM_FEATURE } from '@/server/agents/catalog'
import { FEATURES, findFeature, resolveEntitlements } from '@/server/billing/features'
import { MINIMUM_COST } from '@/server/billing/credits'
import { OPERATION_PROFILES } from '@/server/ai/routing'

/**
 * L'équipe marketing.
 *
 * Ce qui est vérifié ici tient en trois idées. Un spécialiste ne s'ouvre que par la couche
 * de droits, jamais par le nom d'une offre. Une fonction annoncée dans le catalogue doit
 * exister, sans quoi une grille tarifaire la promettrait pour rien. Et chaque question a un
 * prix déclaré, faute de quoi le créateur découvrirait sa dépense après coup.
 */

/*
 * Les offres de ce test déclarent elles-mêmes ce qu'elles ouvrent.
 *
 * Elles empruntaient le catalogue commercial, et le jour où il a changé de métier ces
 * vérifications ont échoué sans qu'une règle de droits ait bougé d'une ligne. Ce qui est
 * vérifié ici est le mécanisme — accordé, verrouillé, prévu — pas la composition des offres
 * du moment, qui se décide ailleurs et se change sans prévenir.
 */
const PLANS = [
  { id: 'free', name: 'Découverte', features: [], sortOrder: 0 },
  {
    id: 'launch',
    name: 'Launch',
    features: ['social_launch_basic', 'social_angles'],
    sortOrder: 1,
  },
  {
    id: 'builder',
    name: 'Builder',
    features: ['social_launch_basic', 'social_angles', 'social_agent'],
    sortOrder: 2,
  },
  {
    id: 'business',
    name: 'Business',
    features: [
      'social_launch_basic',
      'social_angles',
      'social_agent',
      'marketing_team',
      'seo_agent',
      'analytics_agent',
    ],
    sortOrder: 3,
  },
]

describe('catalogue des spécialistes', () => {
  it('rattache chaque spécialiste à une fonction qui existe vraiment', () => {
    const orphelins = AGENTS.filter((agent) => findFeature(agent.feature) === undefined).map(
      (agent) => `${agent.name} pointe vers ${agent.feature}`,
    )
    expect(orphelins).toEqual([])
  })

  it('ne propose que des spécialistes construits', () => {
    const promesses = AGENTS.filter(
      (agent) => findFeature(agent.feature)?.status !== 'live',
    ).map((agent) => agent.name)
    expect(promesses).toEqual([])
  })

  it('donne à chacun un prénom, un métier et de quoi démarrer', () => {
    for (const agent of AGENTS) {
      expect(agent.name.length, agent.id).toBeGreaterThan(1)
      expect(agent.role.length, agent.id).toBeGreaterThan(3)
      expect(agent.starters.length, agent.id).toBeGreaterThanOrEqual(2)
    }
    expect(new Set(AGENTS.map((agent) => agent.id)).size).toBe(AGENTS.length)
    expect(AGENTS.map((agent) => agent.id).sort()).toEqual([...AGENT_IDS].sort())
  })

  it('retrouve un spécialiste par son identifiant, et rien d’autre', () => {
    expect(findAgent('social')?.name).toBe('Tom')
    expect(findAgent('inconnu')).toBeUndefined()
  })
})

describe('ouverture par l’offre', () => {
  it('n’ouvre aucun spécialiste à l’offre de découverte', () => {
    const droits = resolveEntitlements(PLANS[0]!, PLANS)
    for (const agent of AGENTS) {
      expect(droits.granted, agent.id).not.toContain(agent.feature)
    }
  })

  it('nomme l’offre qui ouvrirait un spécialiste fermé', () => {
    const droits = resolveEntitlements(PLANS[0]!, PLANS)
    for (const agent of AGENTS) {
      const verrou = droits.locked.find((entry) => entry.feature.id === agent.feature)
      expect(verrou?.availableWith, agent.id).not.toBeNull()
    }
  })

  /*
   * La fonction « équipe » ne s'ouvre pas seule. Relier trois spécialistes entre eux n'a
   * aucun sens dans une offre qui n'en donne aucun : la personne paierait une coordination
   * sans rien à coordonner.
   */
  it('n’ouvre l’équipe que là où au moins deux spécialistes le sont', () => {
    const fautes = PLANS.filter((plan) => plan.features.includes(TEAM_FEATURE))
      .filter(
        (plan) =>
          AGENTS.filter((agent) => plan.features.includes(agent.feature)).length < 2,
      )
      .map((plan) => plan.id)
    expect(fautes).toEqual([])
  })
})

describe('coût annoncé', () => {
  it('déclare un plancher et un profil pour chaque opération nouvelle', () => {
    for (const operation of ['specialist', 'contentVariation', 'monthlyPlan'] as const) {
      expect(MINIMUM_COST[operation], operation).toBeGreaterThan(0)
      expect(OPERATION_PROFILES[operation], operation).toBeDefined()
    }
  })

  /*
   * Une question doit rester bon marché. Si elle coûtait autant qu'une construction, plus
   * personne n'oserait en poser, et la fonction ne servirait à rien.
   */
  it('garde une question de spécialiste bien moins chère qu’une construction', () => {
    expect(MINIMUM_COST.specialist).toBeLessThan(MINIMUM_COST.generate / 4)
  })

  it('ne laisse aucune fonction du catalogue sans statut lisible', () => {
    for (const feature of FEATURES) {
      expect(['live', 'prevu'], feature.id).toContain(feature.status)
      expect(feature.summary.length, feature.id).toBeGreaterThan(10)
    }
  })
})
