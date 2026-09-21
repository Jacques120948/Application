import { describe, expect, it } from 'vitest'
import { evaluer, type ContexteRegles } from '@/server/ads/regles'
import { lectureObjectifs, PROFIL_VIDE, rythmeBudget, type ProfilAds } from '@/server/ads/profil'
import { indicateurs, type Indicateurs } from '@/server/ads/metriques'
import type { CampagneVue, TableauAds } from '@/server/ads/tableau'

/**
 * Le moteur de règles.
 *
 * Ce qui se vérifie ici n'est pas qu'il trouve des choses — n'importe quelle règle trouve
 * quelque chose — mais qu'il se taise quand il n'a pas de quoi parler. Un avis rendu sur une
 * vente, ou sur un compte dont on ignore la marge, est pire qu'un silence : il a l'air
 * d'être fondé, et il décide d'une dépense réelle.
 */

const DEVISE = 'CHF'

function chiffres(cout: number, valeur: number, conversions: number, extra: Partial<Indicateurs> = {}) {
  const base = indicateurs({
    coutMicros: cout * 1_000_000,
    impressions: 1_000,
    clics: 50,
    conversions,
    valeurConversion: valeur,
  })
  return { ...base, ...extra }
}

function campagne(champs: Partial<CampagneVue> & { nom: string; actuel: Indicateurs }): CampagneVue {
  return {
    id: champs.nom,
    type: 'SEARCH',
    statut: 'ENABLED',
    budget: 10,
    budgetLimite: false,
    roas: { valeur: champs.actuel.roas, variation: null, points: null },
    cpa: { valeur: champs.actuel.cpa, variation: null, points: null },
    cout: { valeur: champs.actuel.cout, variation: null, points: null },
    part: 100,
    ...champs,
  }
}

function tableau(jours: number, campagnes: CampagneVue[], total?: Indicateurs): TableauAds {
  const somme =
    total ??
    chiffres(
      campagnes.reduce((s, c) => s + c.actuel.cout, 0),
      campagnes.reduce((s, c) => s + c.actuel.valeur, 0),
      campagnes.reduce((s, c) => s + c.actuel.conversions, 0),
    )
  const vide = { valeur: null, variation: null, points: null }
  return {
    compte: {
      id: 'compte',
      compteId: '1869511296',
      nom: 'Cap Nature',
      devise: DEVISE,
      fuseau: 'Europe/Zurich',
      gestionnaire: false,
      actif: true,
      synchroAt: new Date(),
      lisible: true,
    },
    jours: jours as TableauAds['jours'],
    depuis: '2026-08-22',
    jusqua: '2026-09-20',
    total: somme,
    ecarts: { cout: vide, conversions: vide, valeur: vide, roas: vide, cpa: vide, ctr: vide, cpc: vide },
    campagnes,
    serie: [],
    tri: 'depense',
    synchronise: true,
  }
}

function contexte(
  campagnes: CampagneVue[],
  profil: Partial<ProfilAds> = {},
  budget: Parameters<typeof lectureObjectifs>[3] = null,
  courtes?: CampagneVue[],
): ContexteRegles {
  const complet: ProfilAds = { ...PROFIL_VIDE, ...profil }
  const longue = tableau(30, campagnes)
  return {
    devise: DEVISE,
    profil: complet,
    lecture: lectureObjectifs(complet, longue.total, DEVISE, budget),
    longue,
    courte: tableau(14, courtes ?? campagnes),
  }
}

const regles = (constats: ReturnType<typeof evaluer>) => constats.map((c) => c.regle)

describe('sans la marge', () => {
  it('ne rend aucun verdict de rentabilité', () => {
    // 60 dépensés pour 30 de valeur : catastrophique. Mais sans marge, on ne sait pas.
    const constats = evaluer(contexte([campagne({ nom: 'A', actuel: chiffres(60, 30, 4) })]))
    expect(regles(constats)).not.toContain('ads.compte.perte')
    expect(regles(constats)).not.toContain('ads.campagne.perte')
    expect(regles(constats)).not.toContain('ads.budget.limite')
  })

  it('signale quand même ce qui ne dépend pas d’elle', () => {
    // Une campagne qui dépense sans jamais vendre se constate sans connaître la marge.
    const constats = evaluer(contexte([campagne({ nom: 'A', actuel: chiffres(60, 0, 0) })]))
    expect(regles(constats)).toContain('ads.sans.conversion')
  })
})

describe('la perte', () => {
  it('se dit quand le ROAS passe sous le seuil, avec assez de ventes', () => {
    // Marge 40 % → seuil 250 %. 100 dépensés, 143 de valeur → 143 %.
    const constats = evaluer(
      contexte([campagne({ nom: 'A', actuel: chiffres(100, 143, 4) })], { margePourcent: 40 }),
    )
    expect(regles(constats)).toContain('ads.compte.perte')
    expect(regles(constats)).toContain('ads.campagne.perte')
  })

  it('se tait quand il n’y a pas eu assez de ventes pour juger', () => {
    /*
     * Une vente en trente jours ne décide de rien. Le plancher n'est pas de la prudence
     * décorative : sans lui, la première vente d'une campagne neuve déclencherait un avis
     * « mettez-la en pause ».
     */
    const constats = evaluer(
      contexte([campagne({ nom: 'A', actuel: chiffres(100, 30, 1) })], { margePourcent: 40 }),
    )
    expect(regles(constats)).not.toContain('ads.compte.perte')
    expect(regles(constats)).not.toContain('ads.campagne.perte')
  })

  it('ne dit pas deux fois la même chose', () => {
    /*
     * Une campagne perdante dont le coût par vente dépasse aussi la cible, c'est le même
     * argent et le même problème. Une liste qui répète est une liste qu'on cesse de lire.
     */
    const constats = evaluer(
      contexte([campagne({ nom: 'A', actuel: chiffres(100, 143, 4) })], {
        margePourcent: 40,
        cpaCible: 5,
      }),
    )
    expect(regles(constats)).toContain('ads.campagne.perte')
    expect(regles(constats)).not.toContain('ads.cpa.derive')
  })
})

describe('la campagne qui ne vend pas', () => {
  it('se tait quand elle pèse trop peu', () => {
    const grosse = campagne({ nom: 'Grosse', actuel: chiffres(95, 400, 8), part: 95 })
    const miette = campagne({ nom: 'Miette', actuel: chiffres(5, 0, 0), part: 5 })
    expect(regles(evaluer(contexte([grosse, miette])))).not.toContain('ads.sans.conversion')
  })

  it('renvoie d’abord vérifier le suivi des conversions', () => {
    const constats = evaluer(contexte([campagne({ nom: 'A', actuel: chiffres(60, 0, 0) })]))
    const constat = constats.find((c) => c.regle === 'ads.sans.conversion')
    expect(constat?.observation).toContain('suivi des conversions')
  })
})

describe('le budget bridé', () => {
  const rentable = campagne({
    nom: 'A',
    actuel: chiffres(100, 400, 5),
    budgetLimite: true,
    budget: 15,
  })

  it('devient une occasion quand la campagne est au-dessus du seuil', () => {
    const constats = evaluer(contexte([rentable], { margePourcent: 40 }))
    const constat = constats.find((c) => c.regle === 'ads.budget.limite')
    expect(constat?.priorite).toBe('opportunite')
    expect(constat?.donnees.propose).toBe(18)
    expect(constat?.action.proposeMicros).toBe(18_000_000)
  })

  it('ne promet pas que les ventes suivront', () => {
    const constats = evaluer(contexte([rentable], { margePourcent: 40 }))
    const constat = constats.find((c) => c.regle === 'ads.budget.limite')
    expect(constat?.observation).toContain('Rien ne garantit')
  })

  it('ne dit rien quand la campagne bridée perd de l’argent', () => {
    // Débrider une campagne qui perd revient à perdre plus vite.
    const perdante = campagne({
      nom: 'B',
      actuel: chiffres(100, 120, 4),
      budgetLimite: true,
      budget: 15,
    })
    expect(regles(evaluer(contexte([perdante], { margePourcent: 40 })))).not.toContain(
      'ads.budget.limite',
    )
  })
})

describe('la chute de ROAS', () => {
  it('exige une baisse à la fois large et relative', () => {
    const grosseChute = campagne({ nom: 'A', actuel: chiffres(100, 300, 4) })
    grosseChute.roas = { valeur: 300, variation: null, points: -200 }
    expect(regles(evaluer(contexte([grosseChute])))).toContain('ads.roas.chute')

    // Vingt points sur un ROAS de cinq cents n'est pas un événement.
    const petiteChute = campagne({ nom: 'B', actuel: chiffres(100, 500, 4) })
    petiteChute.roas = { valeur: 500, variation: null, points: -20 }
    expect(regles(evaluer(contexte([petiteChute])))).not.toContain('ads.roas.chute')
  })
})

describe('le budget du mois', () => {
  it('prévient d’un dépassement, mais pas avant que le mois ait un rythme', () => {
    const avec = evaluer(
      contexte([campagne({ nom: 'A', actuel: chiffres(100, 400, 5) })], { budgetMensuel: 400 },
      rythmeBudget(400, 300, 20, 30)),
    )
    expect(regles(avec)).toContain('ads.budget.depasse')

    // Trois jours écoulés : la projection existe, mais elle ne veut rien dire.
    const trop_tot = evaluer(
      contexte([campagne({ nom: 'A', actuel: chiffres(100, 400, 5) })], { budgetMensuel: 400 },
      rythmeBudget(400, 60, 3, 30)),
    )
    expect(regles(trop_tot)).not.toContain('ads.budget.depasse')
  })
})

describe('la campagne endormie', () => {
  it('se constate sur la fenêtre courte, et seulement si elle est active', () => {
    const muette = campagne({
      nom: 'Muette',
      actuel: { ...chiffres(0, 0, 0), impressions: 0 },
      statut: 'ENABLED',
    })
    const enPause = campagne({
      nom: 'Pause',
      actuel: { ...chiffres(0, 0, 0), impressions: 0 },
      statut: 'PAUSED',
    })
    const constats = evaluer(contexte([], {}, null, [muette, enPause]))
    expect(regles(constats)).toContain('ads.campagne.dormante')
    expect(constats.filter((c) => c.regle === 'ads.campagne.dormante')).toHaveLength(1)
  })
})

describe('l’ordre', () => {
  it('met l’urgent en tête et l’information en queue', () => {
    const perdante = campagne({ nom: 'Perdante', actuel: chiffres(60, 40, 4), part: 60 })
    const muette = campagne({
      nom: 'Muette',
      actuel: { ...chiffres(0, 0, 0), impressions: 0 },
      statut: 'ENABLED',
    })
    const constats = evaluer(contexte([perdante], { margePourcent: 40 }, null, [muette]))
    expect(constats[0]?.priorite).toBe('urgent')
    expect(constats[constats.length - 1]?.priorite).toBe('information')
  })
})

describe('chaque constat', () => {
  it('porte les chiffres qui l’ont déclenché', () => {
    // Un avis sans ses chiffres ne se conteste pas — donc il s'applique de confiance.
    const constats = evaluer(
      contexte([campagne({ nom: 'A', actuel: chiffres(100, 143, 4) })], { margePourcent: 40 }),
    )
    for (const constat of constats) {
      expect(Object.keys(constat.donnees).length).toBeGreaterThan(0)
      expect(constat.observation.length).toBeGreaterThan(40)
      expect(constat.titre).not.toBe('')
    }
  })
})
