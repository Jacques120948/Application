import { describe, expect, it } from 'vitest'
import { assistantsDus, redactionDue } from '@/server/audit/automatisation'

/**
 * Ce qui décide qu'un article automatique part, ou ne part pas.
 *
 * C'est la seule fonction du produit qui puisse dépenser sans qu'une personne clique, et
 * la règle qu'on protège ici n'est pas une préférence : le retard ne se rattrape jamais.
 * Une boucle qui écrirait trois articles parce que trois semaines ont passé sans tournée
 * est une facture qu'on n'a pas vue venir, et c'est exactement ce qu'un rythme est censé
 * empêcher.
 */

const ETEINT = {
  indexation: false,
  releve: false,
  redaction: false,
  depot: false,
  assistants: false,
  blogId: '',
  parPeriode: 1,
  periode: 'semaine' as const,
  indexeAt: null,
  releveAt: null,
  redigeAt: null,
  assistantsAt: null,
}

const LE_20 = new Date('2026-09-20T03:00:00Z')

describe('la rédaction automatique', () => {
  it('ne part jamais quand elle n’est pas allumée', () => {
    expect(redactionDue({ ...ETEINT, redigeAt: null }, LE_20)).toBe(false)
  })

  it('part une première fois quand rien n’a encore été écrit', () => {
    expect(redactionDue({ ...ETEINT, redaction: true }, LE_20)).toBe(true)
  })

  it('attend l’intervalle du rythme choisi', () => {
    const base = { ...ETEINT, redaction: true, parPeriode: 1, periode: 'semaine' as const }

    // Six jours après : trop tôt pour un article par semaine.
    expect(redactionDue({ ...base, redigeAt: new Date('2026-09-14T03:00:00Z') }, LE_20)).toBe(false)
    // Sept jours après : dû.
    expect(redactionDue({ ...base, redigeAt: new Date('2026-09-13T03:00:00Z') }, LE_20)).toBe(true)
  })

  it('raccourcit l’intervalle quand le rythme est plus soutenu', () => {
    const base = { ...ETEINT, redaction: true, parPeriode: 2, periode: 'semaine' as const }
    // Deux par semaine : trois jours et demi entre deux articles.
    expect(redactionDue({ ...base, redigeAt: new Date('2026-09-16T03:00:00Z') }, LE_20)).toBe(true)
    expect(redactionDue({ ...base, redigeAt: new Date('2026-09-17T03:00:00Z') }, LE_20)).toBe(false)
  })

  it('compte en mois quand c’est la période choisie', () => {
    const base = { ...ETEINT, redaction: true, parPeriode: 1, periode: 'mois' as const }
    expect(redactionDue({ ...base, redigeAt: new Date('2026-09-01T03:00:00Z') }, LE_20)).toBe(false)
    expect(redactionDue({ ...base, redigeAt: new Date('2026-08-01T03:00:00Z') }, LE_20)).toBe(true)
  })

  it('ne rattrape pas le retard : un passage tardif ne vaut qu’un article', () => {
    /*
     * La propriété qui compte. Trois semaines sans tournée, rythme hebdomadaire : la
     * fonction dit « dû », une fois. Elle ne dit jamais « dû trois fois », et le module qui
     * l'appelle n'écrit qu'un article par site et par nuit.
     */
    const tresEnRetard = {
      ...ETEINT,
      redaction: true,
      redigeAt: new Date('2026-08-30T03:00:00Z'),
    }
    expect(redactionDue(tresEnRetard, LE_20)).toBe(true)
    // Et dès qu'un article est écrit, le compteur repart de ce jour-là.
    expect(redactionDue({ ...tresEnRetard, redigeAt: LE_20 }, LE_20)).toBe(false)
  })
})

describe('le relevé dans les assistants', () => {
  it('ne part pas quand il n’est pas allumé', () => {
    expect(assistantsDus({ ...ETEINT, assistantsAt: null }, LE_20)).toBe(false)
  })

  it('part une première fois, puis une fois par semaine', () => {
    /*
     * Hebdomadaire et non quotidien : ce qu'un assistant répond lundi et mardi est la même
     * chose, à son aléa près. Payer sept fois pour une information qui change au mois est
     * une dépense sans contrepartie.
     */
    const base = { ...ETEINT, assistants: true }
    expect(assistantsDus(base, LE_20)).toBe(true)
    expect(assistantsDus({ ...base, assistantsAt: new Date('2026-09-14T03:00:00Z') }, LE_20)).toBe(
      false,
    )
    expect(assistantsDus({ ...base, assistantsAt: new Date('2026-09-13T03:00:00Z') }, LE_20)).toBe(
      true,
    )
  })

  it('ne rattrape pas le retard', () => {
    const base = { ...ETEINT, assistants: true, assistantsAt: new Date('2026-07-01T03:00:00Z') }
    expect(assistantsDus(base, LE_20)).toBe(true)
    // Un passage remet le compteur à ce jour-là : un seul relevé, pas douze.
    expect(assistantsDus({ ...base, assistantsAt: LE_20 }, LE_20)).toBe(false)
  })
})
