import { describe, expect, it } from 'vitest'
import { describeIncidents } from '@/server/agent/incidents'

/**
 * Ce que l'agent apprend d'un échec.
 *
 * Deux propriétés, et elles tirent dans des sens opposés — c'est pour ça qu'il faut les
 * tenir toutes les deux.
 *
 * **Assez pour être utile.** « Je ne sais pas » à la place de « il ne vous restait plus de
 * crédits » est la réponse qui fait partir un créateur.
 *
 * **Pas assez pour renseigner qui que ce soit.** Le message brut du fournisseur ne franchit
 * pas cette frontière : il peut porter un nom d'hôte, une limite de compte, un détail
 * d'infrastructure. Seul le code en sort, traduit.
 */

describe('le rapport d’incidents', () => {
  it('dit qu’il n’y a rien eu, et où chercher alors', () => {
    const texte = describeIncidents([])
    expect(texte).toMatch(/rien n'a échoué/i)
    // Sans cette seconde phrase, un agent conclurait « tout va bien » et s'arrêterait là,
    // alors que le problème est dans l'application.
    expect(texte).toMatch(/contrôles/i)
  })

  it('nomme l’opération comme le créateur l’a vécue, et la cause en clair', () => {
    const texte = describeIncidents([
      {
        quoi: 'construction de votre application',
        pourquoi: "il ne restait plus assez de crédits pour aller au bout",
        quand: new Date('2026-09-15T10:00:00Z'),
      },
    ])
    expect(texte).toContain('construction de votre application')
    expect(texte).toContain('plus assez de crédits')
    expect(texte).toContain('15/09/2026')
  })

  it('ne laisse passer aucun vocabulaire technique', () => {
    const texte = describeIncidents([
      {
        quoi: "création d'une image",
        pourquoi: "l'offre en cours ne permettait pas cette action",
        quand: new Date('2026-09-16T08:00:00Z'),
      },
    ])
    for (const interdit of ['PLAN_LIMIT', 'error', 'http', '500', 'api']) {
      expect(texte.toLowerCase()).not.toContain(interdit.toLowerCase())
    }
  })
})
