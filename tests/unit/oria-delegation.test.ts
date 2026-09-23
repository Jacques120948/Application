import { describe, expect, it } from 'vitest'
import { destinataires, questionPour } from '@/server/oria/delegation'
import type { Signal } from '@/server/oria/signaux'

/**
 * À qui Oria transmet, et ce qu'elle demande.
 *
 * Les enchaînements sont ceux du cahier des charges, écrits en règles plutôt que devinés :
 * une campagne qui s'essouffle part aussi chez Milo pour de nouveaux angles, des clics sans
 * vente partent chez Cleo pour la page d'arrivée, un constat de page part chez Milo pour le
 * texte de remplacement.
 */

function signal(partiel: Partial<Signal>): Signal {
  return {
    cle: 'x',
    sources: ['seo'],
    titre: 'Un titre',
    pourquoi: 'Parce que.',
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

describe('les destinataires d’une délégation', () => {
  it('commencent par ceux qui ont relevé le point', () => {
    expect(destinataires(signal({ sources: ['meta'] }))[0]?.agent).toBe('meta')
  })

  it('envoient une campagne qui s’essouffle chez Cleo et chez Milo', () => {
    const agents = destinataires(signal({ sources: ['meta'] })).map((un) => un.agent)
    expect(agents).toEqual(['meta', 'cro', 'content'])
  })

  it('envoient des clics Google sans vente chez Cleo, pas chez Milo', () => {
    const agents = destinataires(signal({ sources: ['ads'] })).map((un) => un.agent)
    expect(agents).toEqual(['ads', 'cro'])
  })

  it('envoient un constat de page chez Milo pour le texte', () => {
    expect(destinataires(signal({ sources: ['cro'] })).map((un) => un.agent)).toEqual(['cro', 'content'])
  })

  it('ne proposent jamais le même agent deux fois, ni plus de trois', () => {
    const agents = destinataires(signal({ sources: ['cro', 'meta'] })).map((un) => un.agent)
    expect(new Set(agents).size).toBe(agents.length)
    expect(agents.length).toBeLessThanOrEqual(3)
  })
})

describe('la question qu’Oria pose', () => {
  it('cite le point et nomme celui qui l’a relevé', () => {
    const question = questionPour(signal({ sources: ['meta'], titre: 'La campagne fatigue' }), 'cro')
    expect(question).toContain('MIRA a relevé')
    expect(question).toContain('« La campagne fatigue »')
  })

  it('demande des angles sans chiffre inventé quand Milo reprend une publicité', () => {
    const question = questionPour(signal({ sources: ['meta'] }), 'content')
    expect(question).toContain('cinq angles')
    expect(question).toContain('N’inventez aucun chiffre')
  })

  it('tient dans ce qu’une conversation accepte', () => {
    const long = 'mot '.repeat(400)
    expect(questionPour(signal({ titre: long, pourquoi: long }), 'seo').length).toBeLessThanOrEqual(600)
  })
})
