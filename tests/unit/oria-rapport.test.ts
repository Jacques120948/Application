import { describe, expect, it } from 'vitest'
import { lireLaSemaine, resultatsPublicitaires, sensDe } from '@/server/oria/rapport'
import { faitsDeLaSemaine, faitsDuJour } from '@/server/oria/resume'
import { oriaResumeSchema } from '@/server/ai/schemas'
import type { Signal } from '@/server/oria/signaux'

/**
 * Le rapport de la semaine et ce qui part chez le modèle.
 *
 * Le rapport est l'endroit du produit où l'on est le plus tenté de raconter une histoire :
 * « vos conversions ont bondi grâce à la nouvelle page ». Ces tests tiennent la ligne
 * inverse — un écart sans repère n'est pas un progrès, un écart de bruit n'est pas une
 * victoire, une dépense n'est ni bonne ni mauvaise, et rien ne relie une action à un
 * résultat.
 */

const cumul = (cout: number, clics: number, conversions: number) => ({ cout, clics, conversions, valeur: 0 })

describe('le sens d’un écart', () => {
  it('ne calcule rien sans repère : une première semaine commence, elle ne progresse pas', () => {
    expect(sensDe(0, 120, true)).toEqual({ ecart: null, sens: 'nouveau' })
    expect(sensDe(null, 120, true)).toEqual({ ecart: null, sens: 'nouveau' })
    expect(sensDe(0, 0, true)).toEqual({ ecart: null, sens: 'neutre' })
  })

  it('appelle bruit un écart de moins d’un quart', () => {
    expect(sensDe(100, 115, true).sens).toBe('stable')
    expect(sensDe(100, 80, true).sens).toBe('stable')
  })

  it('lit le sens selon ce que la mesure veut dire', () => {
    expect(sensDe(10, 20, true).sens).toBe('mieux')
    expect(sensDe(10, 20, false).sens).toBe('moins-bien')
    expect(sensDe(20, 10, false).sens).toBe('mieux')
  })

  it('ne juge jamais une dépense', () => {
    expect(sensDe(100, 300, null).sens).toBe('neutre')
  })
})

describe('les résultats publicitaires', () => {
  it('ne calcule le coût par conversion que si les deux semaines en ont eu', () => {
    const sans = resultatsPublicitaires('Meta Ads', 'CHF', cumul(100, 50, 0), cumul(120, 60, 3))
    expect(sans.map((un) => un.quoi)).not.toContain('Meta Ads — coût par conversion')

    const avec = resultatsPublicitaires('Meta Ads', 'CHF', cumul(100, 50, 4), cumul(120, 60, 3))
    const cpa = avec.find((un) => un.quoi === 'Meta Ads — coût par conversion')
    expect(cpa?.avant).toBe(25)
    expect(cpa?.apres).toBe(40)
    expect(cpa?.sens).toBe('moins-bien')
  })
})

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

describe('la lecture de la semaine', () => {
  it('ne compte comme victoire qu’un écart favorable notable', () => {
    const resultats = [
      ...resultatsPublicitaires('Meta Ads', 'CHF', cumul(100, 50, 2), cumul(110, 55, 6)),
    ]
    const { victoires, attention } = lireLaSemaine(resultats, [], [], { signaux: [], canaux: [] })
    expect(victoires.some((un) => un.includes('conversions'))).toBe(true)
    // Les clics ont pris 10 % : du bruit, ni victoire ni alerte.
    expect(victoires.some((un) => un.includes('clics'))).toBe(false)
    expect(attention.some((un) => un.includes('clics'))).toBe(false)
    // La dépense n'est jamais jugée.
    expect([...victoires, ...attention].some((un) => un.includes('dépense'))).toBe(false)
  })

  it('range une note en baisse et un constat critique parmi les points d’attention', () => {
    const { victoires, attention } = lireLaSemaine(
      [],
      [
        { quoi: 'Référencement', delta: 4 },
        { quoi: 'Conversion', delta: -6 },
        { quoi: 'Moteurs IA', delta: null },
      ],
      ['Pages sans titre'],
      { signaux: [signal({ cle: 'panne', titre: 'Le site ne répond plus', urgence: 'critique' })], canaux: [] },
    )
    expect(victoires).toContain('Référencement : +4 points à la dernière analyse.')
    expect(victoires).toContain('« Pages sans titre » ne remonte plus dans la dernière analyse.')
    expect(attention).toContain('Conversion : −6 points à la dernière analyse.')
    expect(attention).toContain('Le site ne répond plus.')
  })
})

describe('ce qui part chez le modèle', () => {
  it('ne transmet ni adresse ni identifiant', () => {
    /*
     * Ce qui n'est pas nécessaire à la tâche ne part pas chez un tiers. Le résumé n'a
     * besoin que de titres, d'états et d'écarts — pas des liens vers les écrans ni des clés
     * internes des constats.
     */
    const faits = faitsDuJour({
      objectifs: { objectifs: ['ventes'], activite: '', deduite: false },
      canaux: [],
      signaux: [
        signal({ cle: 'plan:cro.cta.absent', titre: 'Aucun bouton d’action', href: '/fr/visibilite/conversion?siteId=abc' }),
      ],
      priorites: [
        signal({ cle: 'plan:cro.cta.absent', titre: 'Aucun bouton d’action', href: '/fr/visibilite/conversion?siteId=abc' }),
      ],
    })
    const texte = JSON.stringify(faits)
    expect(texte).not.toContain('siteId')
    expect(texte).not.toContain('/fr/')
    expect(texte).not.toContain('plan:cro')
    expect(texte).toContain('Augmenter les ventes')
  })

  it('transmet la semaine sans liens ni clés', () => {
    const faits = faitsDeLaSemaine({
      site: { id: '11111111-1111-1111-1111-111111111111', host: 'exemple.ch' },
      depuis: new Date('2026-09-16'),
      jusqua: new Date('2026-09-23'),
      resultats: [],
      victoires: [],
      attention: [],
      actions: [],
      priorites: [],
      absents: ['Google Ads n’est pas relié.'],
    })
    const texte = JSON.stringify(faits)
    expect(texte).not.toContain('11111111')
    expect(texte).toContain('Google Ads n’est pas relié.')
  })

  it('refuse une sixième phrase', () => {
    const six = { phrases: ['Un.', 'Deux.', 'Trois.', 'Quatre.', 'Cinq.', 'Six.'] }
    expect(oriaResumeSchema.safeParse(six).success).toBe(false)
    expect(oriaResumeSchema.safeParse({ phrases: six.phrases.slice(0, 5) }).success).toBe(true)
  })
})
