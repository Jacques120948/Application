import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VISIBILITY_AGENTS, VISIBILITY_AGENT_IDS } from '@/server/agents/visibility'
import { FEATURE_IDS } from '@/server/billing/features'

/**
 * L'équipe de visibilité, et ce qui doit rester vrai quand elle s'agrandit.
 *
 * À ne pas confondre avec `equipe.test.ts`, qui vérifie l'équipe marketing et sa mécanique
 * de droits. Ici, ce sont les cinq spécialistes du produit de visibilité, et les invariants
 * protégés sont ceux d'un écran qu'on ne regarde plus une fois qu'il marche.
 */
describe('l’équipe de visibilité', () => {
  it('compte les cinq métiers, chacun une seule fois', () => {
    expect(VISIBILITY_AGENTS.map((agent) => agent.id)).toEqual([...VISIBILITY_AGENT_IDS])
    expect(new Set(VISIBILITY_AGENT_IDS).size).toBe(VISIBILITY_AGENT_IDS.length)
  })

  it('n’annonce un portrait que lorsque le fichier existe', () => {
    /*
     * L'invariant qui protège la page d'accueil. `AgentAvatar` ne retombe sur la pastille à
     * initiale que si `avatar` est absent : une adresse pointant vers un fichier manquant
     * n'affiche pas un repli, elle affiche une image cassée. Et une image cassée sur la
     * page que tout le monde voit coûte plus cher qu'un portrait qu'on trouve tiède.
     */
    const manquants = VISIBILITY_AGENTS.filter((agent) => agent.avatar !== undefined).filter(
      (agent) => !existsSync(join(process.cwd(), 'public', agent.avatar!.replace(/^\//u, ''))),
    )
    expect(manquants.map((agent) => agent.name)).toEqual([])
  })

  it('ouvre chaque spécialiste par un droit qui existe', () => {
    /*
     * Un spécialiste dont le droit n'est déclaré nulle part ne s'ouvre jamais, et rien ne
     * le signale : `requireFeature` refuse, l'écran dit « hors de votre offre », et on
     * cherche du côté de l'abonnement un défaut qui est dans le catalogue.
     */
    const orphelins = VISIBILITY_AGENTS.filter((agent) => !FEATURE_IDS.includes(agent.feature))
    expect(orphelins.map((agent) => agent.name)).toEqual([])
  })

  it('donne à chacun sa teinte, et Naya la sienne', () => {
    const teintes = VISIBILITY_AGENTS.map((agent) => agent.tint)
    expect(new Set(teintes).size).toBe(VISIBILITY_AGENTS.length)
    expect(VISIBILITY_AGENTS.find((agent) => agent.id === 'ads')?.name).toBe('Naya')
  })

  it('ne promet, pour chacun, que ce qu’il fait déjà', () => {
    /*
     * `atWork` décrit le présent livré. Naya répond aux questions mais ne lit encore aucune
     * campagne : sa ligne reste vide jusqu'à ce que la connexion Google Ads existe.
     * Décrire une équipe au futur est la façon la plus sûre de décevoir quelqu'un qui
     * s'inscrit.
     */
    expect(VISIBILITY_AGENTS.find((agent) => agent.id === 'ads')?.atWork).toBeNull()
  })
})
