import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VISIBILITY_AGENTS, VISIBILITY_AGENT_IDS } from '@/server/agents/visibility'
import { FEATURE_IDS, findFeature } from '@/server/billing/features'

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

  /**
   * La teinte ne distingue que ceux qu'aucun portrait ne distingue déjà.
   *
   * Ce test exigeait une teinte unique par membre. C'était juste tant qu'il y avait autant
   * de membres que de jetons de couleur, et c'est devenu impossible en arrivant à sept —
   * or le catalogue de jetons est celui du design system, qu'on n'élargit pas pour loger un
   * septième prénom.
   *
   * L'invariant durable est ailleurs : la teinte ne sert qu'à la pastille à initiale, qui
   * ne s'affiche que pour un membre sans portrait. Deux membres illustrés peuvent donc
   * partager une couleur sans qu'on les confonde jamais ; deux membres sans portrait, non.
   */
  it('ne fait porter la même teinte qu’à des membres déjà distingués par leur portrait', () => {
    const sansPortrait = VISIBILITY_AGENTS.filter((agent) => agent.avatar === undefined)
    const teintes = sansPortrait.map((agent) => agent.tint)
    expect(new Set(teintes).size).toBe(sansPortrait.length)
    expect(VISIBILITY_AGENTS.find((agent) => agent.id === 'ads')?.name).toBe('Naya')
  })

  it('ne promet, pour chacun, que ce qu’il fait déjà — et ne tait pas ce qu’il fait', () => {
    /*
     * `atWork` décrit le présent livré, et la carte de la page d'accueil affiche « à venir »
     * quand il est vide.
     *
     * La première version de ce test figeait un état : elle exigeait que Naya reste muette,
     * ce qui était juste tant qu'elle ne lisait aucune campagne, et faux le jour où elle en
     * a lu. Décrire une équipe au futur déçoit celui qui s'inscrit ; la décrire au passé
     * fait fuir celui à qui l'on avait justement la réponse. Les deux fautes se valent.
     *
     * L'invariant durable est donc l'accord entre la fiche d'offre et la carte : un
     * spécialiste dont la fonction est livrée dit ce qu'il fait, un spécialiste encore prévu
     * se tait.
     */
    const desaccords = VISIBILITY_AGENTS.filter((agent) => {
      const fonction = findFeature(agent.feature)
      if (fonction === undefined) return false
      const livre = fonction.status === 'live'
      return livre ? agent.atWork === null : agent.atWork !== null
    })

    expect(desaccords.map((agent) => agent.name)).toEqual([])
  })
})
