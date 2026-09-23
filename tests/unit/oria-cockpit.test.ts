import { describe, expect, it } from 'vitest'
import { etatsEquipe, phraseDuJour } from '@/server/oria/cockpit'
import { santeMarketing, type EntreeSante } from '@/server/oria/sante'
import type { Signal } from '@/server/oria/signaux'

/**
 * Ce que le cockpit affiche en premier, et qui est donc le plus exposé.
 *
 * La phrase du jour et le statut des agents sont lus avant tout le reste. Ce sont aussi
 * les deux endroits où la tentation est la plus forte de dire quelque chose de rassurant
 * plutôt que de vrai : « tout va bien » quand on ne regarde pas, « actif » quand rien
 * n'est relié. Ces tests tiennent les deux.
 */

function entree(partiel: Partial<EntreeSante> = {}): EntreeSante {
  return {
    seoScore: 80,
    geoScore: 80,
    croScore: 80,
    siteAnalyse: true,
    pannes: 0,
    ads: { relie: true, urgents: 0, aSurveiller: 0 },
    meta: { relie: true, urgents: 0, aSurveiller: 0 },
    ...partiel,
  }
}

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

describe('la phrase du jour', () => {
  it('nomme la faiblesse avec le chiffre qui l’a désignée', () => {
    const phrase = phraseDuJour(santeMarketing(entree({ croScore: 41 })))
    expect(phrase).toContain('Conversion')
    expect(phrase).toContain('41/100')
  })

  it('ne dit jamais que tout va bien sur ce qu’elle ne regarde pas', () => {
    /*
     * Sans compte publicitaire relié, la phrase doit dire qu'elle ne voit pas la
     * publicité — pas la ranger parmi ce qui tient.
     */
    const phrase = phraseDuJour(
      santeMarketing(
        entree({
          ads: { relie: false, urgents: 0, aSurveiller: 0 },
          meta: { relie: false, urgents: 0, aSurveiller: 0 },
        }),
      ),
    )
    expect(phrase).toContain('Je ne vois pas encore Google Ads et Meta Ads')
    const [avant] = phrase.split('Je ne vois pas')
    expect(avant).not.toContain('Google Ads')
    expect(avant).not.toContain('Meta Ads')
  })

  it('avoue n’avoir rien quand rien n’est mesuré', () => {
    const phrase = phraseDuJour(
      santeMarketing(
        entree({
          seoScore: null,
          geoScore: null,
          croScore: null,
          siteAnalyse: false,
          ads: { relie: false, urgents: 0, aSurveiller: 0 },
          meta: { relie: false, urgents: 0, aSurveiller: 0 },
        }),
      ),
    )
    expect(phrase).toContain('Je n’ai encore rien de mesuré')
  })

  it('tient en deux phrases au plus', () => {
    const phrase = phraseDuJour(
      santeMarketing(entree({ seoScore: 30, meta: { relie: false, urgents: 0, aSurveiller: 0 } })),
    )
    expect(phrase.split(/(?<=\.)\s/u).length).toBeLessThanOrEqual(2)
  })
})

describe('le statut des agents', () => {
  const base = {
    signaux: [] as Signal[],
    sourcesLues: ['audit', 'seo', 'geo', 'cro'] as const,
    site: { id: 's', host: 'exemple.ch' },
    reperes: { audit: new Date('2026-09-20'), ads: null, meta: null },
  }

  it('dit « connexion nécessaire » plutôt qu’« actif » pour un compte non relié', () => {
    const equipe = etatsEquipe({ ...base, sourcesLues: [...base.sourcesLues] })
    expect(equipe.find((un) => un.id === 'ads')?.statut).toBe('connexion')
    expect(equipe.find((un) => un.id === 'meta')?.statut).toBe('connexion')
    expect(equipe.find((un) => un.id === 'seo')?.statut).toBe('actif')
  })

  it('demande une analyse avant de dire qu’un agent du site est actif', () => {
    const equipe = etatsEquipe({ ...base, sourcesLues: [], site: null })
    for (const id of ['audit', 'seo', 'geo', 'content', 'cro'] as const) {
      expect(equipe.find((un) => un.id === id)?.statut, id).toBe('a-lancer')
    }
  })

  it('réclame une action quand un de ses constats est critique', () => {
    const equipe = etatsEquipe({
      ...base,
      sourcesLues: [...base.sourcesLues],
      signaux: [signal({ cle: 'panne', sources: ['audit'], urgence: 'critique' })],
    })
    const lea = equipe.find((un) => un.id === 'audit')
    expect(lea?.statut).toBe('action')
    expect(lea?.critiques).toBe(1)
  })

  it('compte un signal croisé chez chacun de ses auteurs', () => {
    const equipe = etatsEquipe({
      ...base,
      sourcesLues: [...base.sourcesLues, 'ads'],
      signaux: [signal({ cle: 'croisement', sources: ['cro', 'ads'] })],
    })
    expect(equipe.find((un) => un.id === 'cro')?.ouverts).toBe(1)
    expect(equipe.find((un) => un.id === 'ads')?.ouverts).toBe(1)
  })

  it('ne se compte pas elle-même parmi ses agents', () => {
    const equipe = etatsEquipe({ ...base, sourcesLues: [...base.sourcesLues] })
    expect(equipe.map((un) => un.id)).not.toContain('oria')
  })

  it('donne la date réelle de dernière lecture, ou rien', () => {
    const equipe = etatsEquipe({ ...base, sourcesLues: [...base.sourcesLues] })
    expect(equipe.find((un) => un.id === 'seo')?.derniere).toEqual(new Date('2026-09-20'))
    expect(equipe.find((un) => un.id === 'meta')?.derniere).toBeNull()
  })
})
