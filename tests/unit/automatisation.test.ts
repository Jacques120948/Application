import { describe, expect, it } from 'vitest'
import { assistantsDus, cadenceValide, pointDu, redactionDue } from '@/server/audit/automatisation'

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
  assistantsJours: 7,
  point: false,
  blogId: '',
  parPeriode: 1,
  periode: 'semaine' as const,
  indexeAt: null,
  releveAt: null,
  redigeAt: null,
  assistantsAt: null,
  pointAt: null,
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

describe('le point hebdomadaire', () => {
  it('ne part pas quand il n’est pas allumé', () => {
    expect(pointDu({ ...ETEINT, pointAt: null }, LE_20)).toBe(false)
  })

  it('part une première fois, puis une fois par semaine', () => {
    const base = { ...ETEINT, point: true }
    expect(pointDu(base, LE_20)).toBe(true)
    expect(pointDu({ ...base, pointAt: new Date('2026-09-15T03:00:00Z') }, LE_20)).toBe(false)
    expect(pointDu({ ...base, pointAt: new Date('2026-09-13T03:00:00Z') }, LE_20)).toBe(true)
  })

  it('ne rattrape pas le retard', () => {
    /*
     * Un point hebdomadaire écrit trois fois d'affilée sur les mêmes chiffres ne dirait
     * rien de plus et coûterait trois fois.
     */
    const base = { ...ETEINT, point: true, pointAt: new Date('2026-06-01T03:00:00Z') }
    expect(pointDu(base, LE_20)).toBe(true)
    expect(pointDu({ ...base, pointAt: LE_20 }, LE_20)).toBe(false)
  })
})

/**
 * La cadence du relevé dans les assistants.
 *
 * C'est la dépense la plus lourde du produit, et le seul réglage qui la divise sans rien
 * retirer : au mois plutôt qu'à la semaine, vingt questions suivies auprès de trois
 * assistants coûtent soixante crédits au lieu de deux cent soixante. La règle du retard
 * qui ne se rattrape pas vaut ici comme ailleurs — sinon un mois d'arrêt déclencherait
 * quatre relevés d'un coup, exactement la facture qu'une cadence est censée borner.
 */
describe('la cadence du relevé dans les assistants', () => {
  const LE_20_PLUS = (jours: number) => new Date(LE_20.getTime() + jours * 24 * 60 * 60 * 1000)

  it('attend sept jours par défaut', () => {
    const reglages = { ...ETEINT, assistants: true, assistantsAt: LE_20 }
    expect(assistantsDus(reglages, LE_20_PLUS(6))).toBe(false)
    expect(assistantsDus(reglages, LE_20_PLUS(7))).toBe(true)
  })

  it('attend la quinzaine quand la quinzaine est choisie', () => {
    const reglages = { ...ETEINT, assistants: true, assistantsJours: 14, assistantsAt: LE_20 }
    expect(assistantsDus(reglages, LE_20_PLUS(7))).toBe(false)
    expect(assistantsDus(reglages, LE_20_PLUS(14))).toBe(true)
  })

  it('attend le mois quand le mois est choisi', () => {
    const reglages = { ...ETEINT, assistants: true, assistantsJours: 30, assistantsAt: LE_20 }
    expect(assistantsDus(reglages, LE_20_PLUS(29))).toBe(false)
    expect(assistantsDus(reglages, LE_20_PLUS(30))).toBe(true)
  })

  it('ne rattrape pas le retard : un mois d’arrêt donne un relevé, pas quatre', () => {
    const reglages = { ...ETEINT, assistants: true, assistantsAt: LE_20 }
    /*
     * La fonction rend un booléen, pas un nombre : c'est précisément ce qui empêche le
     * rattrapage. Le test le fige, parce qu'un jour quelqu'un voudra « juste » rendre le
     * nombre de périodes écoulées.
     */
    expect(assistantsDus(reglages, LE_20_PLUS(60))).toBe(true)
  })

  /*
   * Ce qui vient du navigateur décide d'une dépense. « Tous les jours » ne doit pas
   * pouvoir entrer par l'API sous prétexte que le menu ne le propose pas.
   */
  it('retombe sur sept jours devant une cadence inventée', () => {
    expect(cadenceValide(1)).toBe(7)
    expect(cadenceValide(0)).toBe(7)
    expect(cadenceValide(-14)).toBe(7)
    expect(cadenceValide(365)).toBe(7)
    expect(cadenceValide(30)).toBe(30)
  })

  it('n’est jamais dû quand le relevé est éteint, quelle que soit la cadence', () => {
    expect(assistantsDus({ ...ETEINT, assistantsJours: 30 }, LE_20_PLUS(365))).toBe(false)
  })
})
