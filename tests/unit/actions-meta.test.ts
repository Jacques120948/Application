import { describe, expect, it } from 'vitest'
import { PROFIL_VIDE } from '@/server/ads/profil'
import { droitsDepuisPortees } from '@/server/ads/droits-meta'
import {
  proposerActionMeta,
  type CadreMeta,
  type ContexteActions,
} from '@/server/ads/actions-meta'
import type { RecommandationMetaVue } from '@/server/ads/recommandations-meta'

/**
 * Ce qui partirait chez Meta, et ce qui ne partira pas.
 *
 * Ces vérifications sont le dernier rempart avant de toucher à l'argent de quelqu'un, et
 * c'est pour cela qu'elles sont pures : aucune base, aucun réseau, aucun écran. Une borne
 * qu'on ne peut vérifier qu'en montant une application est une borne qu'on ne vérifie pas.
 *
 * Quatre propriétés y sont figées, et chacune décrit une façon de nuire à quelqu'un.
 *
 * **Une pause ne doit pas éteindre plus qu'elle n'annonce.** MIRA propose d'arrêter une
 * créative fatiguée ; si c'est la dernière qui diffuse, elle arrête la diffusion. Le constat
 * disait « changez de visuel », pas « coupez la campagne ».
 *
 * **Un budget se propose sur le chiffre du jour.** Un constat ouvert il y a douze jours
 * porte le budget de ce jour-là. Rejouer ce chiffre ferait passer une division par deux pour
 * un palier de vingt pour cent.
 *
 * **Un droit refusé se dit avant le mode.** Quelqu'un dont le jeton ne sait pas écrire doit
 * lire « Meta ne nous l'a pas accordé », pas « passez en mode assisté » — sans quoi il
 * change un réglage qui n'y changera rien.
 *
 * **Ce qu'on ne comprend pas ne se propose pas.** Un type d'action inconnu rend « aucune »,
 * jamais une supposition.
 */

const TOUS_DROITS = droitsDepuisPortees(['ads_read', 'ads_management'])
const LECTURE_SEULE = droitsDepuisPortees(['ads_read'])

function cadre(sur: Partial<CadreMeta> = {}): CadreMeta {
  return {
    mode: 'assiste',
    devise: 'CHF',
    profil: PROFIL_VIDE,
    droits: TOUS_DROITS,
    faitesAujourdhui: 0,
    ...sur,
  }
}

function constat(action: Record<string, unknown>): RecommandationMetaVue {
  return {
    id: 'r1',
    regle: 'meta.creative.fatigue',
    priorite: 'urgent',
    niveau: 'annonce',
    cible: 'Visuel bougie bleue',
    cibleId: 'a1',
    titre: '',
    observation: '',
    pourquoi: '',
    consequence: '',
    recommandation: '',
    jours: 14,
    donnees: {},
    action,
    risque: 'moyen',
    createdAt: new Date(),
    age: 3,
  }
}

/** Deux annonces actives dans un ensemble, deux ensembles actifs dans la campagne. */
function contexte(sur: {
  annonceStatut?: string
  voisinesAnnonces?: number
  ensembleStatut?: string
  voisinsEnsembles?: number
  budgetMicros?: number
  budgetSurLaCampagne?: boolean
} = {}): ContexteActions {
  return {
    ensembles: new Map([
      [
        'g1',
        {
          objetId: '23851234567890123',
          campagneId: 'c1',
          nom: 'Suisse romande',
          statut: sur.ensembleStatut ?? 'ACTIVE',
          budgetMicros: sur.budgetMicros ?? 20_000_000,
          campagneNom: 'Bougies',
          budgetSurLaCampagne: sur.budgetSurLaCampagne ?? false,
          voisinsActifs: sur.voisinsEnsembles ?? 1,
        },
      ],
    ]),
    annonces: new Map([
      [
        'a1',
        {
          objetId: '23859876543210987',
          campagneId: 'c1',
          nom: 'Visuel bougie bleue',
          statut: sur.annonceStatut ?? 'ACTIVE',
          ensembleNom: 'Suisse romande',
          voisinsActifs: sur.voisinesAnnonces ?? 1,
        },
      ],
    ]),
  }
}

describe('mettre en pause une publicité', () => {
  it('est possible quand d’autres continuent de diffuser', () => {
    const issue = proposerActionMeta(constat({ type: 'pause-annonce', annonce: 'a1' }), contexte(), cadre())
    expect(issue.etat).toBe('possible')
    if (issue.etat !== 'possible') return
    expect(issue.action.type).toBe('pause')
    // La phrase dit ce qui s'arrête ET ce qui continue : c'est la moitié qui rassure.
    expect(issue.action.resume).toContain('Visuel bougie bleue')
    expect(issue.action.resume).toContain('continuent')
  })

  it('est refusée quand c’est la dernière qui diffuse', () => {
    const issue = proposerActionMeta(
      constat({ type: 'pause-annonce', annonce: 'a1' }),
      contexte({ voisinesAnnonces: 0 }),
      cadre(),
    )
    expect(issue.etat).toBe('refusee')
    if (issue.etat !== 'refusee') return
    expect(issue.raison).toContain('dernier élément actif')
    // L'action reste décrite : on montre le geste barré, pas un blanc.
    expect(issue.action.resume).not.toBe('')
  })

  it('est refusée sur ce qui ne diffuse pas', () => {
    const issue = proposerActionMeta(
      constat({ type: 'pause-annonce', annonce: 'a1' }),
      contexte({ annonceStatut: 'CAMPAIGN_PAUSED' }),
      cadre(),
    )
    expect(issue.etat).toBe('refusee')
    if (issue.etat !== 'refusee') return
    expect(issue.raison).toContain('CAMPAIGN_PAUSED')
  })
})

describe('baisser un budget', () => {
  it('se calcule sur le budget d’aujourd’hui, pas sur celui du constat', () => {
    const issue = proposerActionMeta(
      constat({ type: 'budget-ensemble', ensemble: 'g1', sens: 'baisse' }),
      contexte({ budgetMicros: 50_000_000 }),
      cadre(),
    )
    expect(issue.etat).toBe('possible')
    if (issue.etat !== 'possible' || issue.action.type !== 'budget') return

    // Un cinquième de moins : 50 → 40, et la valeur d'avant part avec, pour être revérifiée.
    expect(issue.action.versMicros).toBe(40_000_000)
    expect(issue.action.attenduMicros).toBe(50_000_000)
    // Le montant est écrit comme il se lit en Suisse romande : « 50,00 CHF ».
    expect(issue.action.resume).toContain('50,00 CHF')
    expect(issue.action.resume).toContain('40,00 CHF')
  })

  it('est refusée quand la campagne pilote le budget', () => {
    const issue = proposerActionMeta(
      constat({ type: 'budget-ensemble', ensemble: 'g1', sens: 'baisse' }),
      contexte({ budgetSurLaCampagne: true, budgetMicros: 0 }),
      cadre(),
    )
    expect(issue.etat).toBe('refusee')
    if (issue.etat !== 'refusee') return
    // Et elle dit où aller, plutôt que de renvoyer chez Meta en vrac.
    expect(issue.raison).toContain('Bougies')
  })
})

describe('le droit d’écrire', () => {
  it('manque avant tout le reste, et se dit dans les mots de Meta', () => {
    const issue = proposerActionMeta(
      constat({ type: 'pause-annonce', annonce: 'a1' }),
      contexte(),
      cadre({ droits: LECTURE_SEULE }),
    )
    expect(issue.etat).toBe('refusee')
    if (issue.etat !== 'refusee') return
    expect(issue.raison).toContain('Meta n’a pas accordé')
    /*
     * Et surtout pas le message du mode : envoyer quelqu'un changer un réglage qui n'y
     * changera rien est la façon la plus sûre de le faire revenir avec la même erreur.
     */
    expect(issue.raison).not.toContain('mode assisté')
  })

  it('ne suffit pas si le compte est en lecture', () => {
    const issue = proposerActionMeta(
      constat({ type: 'pause-annonce', annonce: 'a1' }),
      contexte(),
      cadre({ mode: 'lecture' }),
    )
    expect(issue.etat).toBe('refusee')
    if (issue.etat !== 'refusee') return
    expect(issue.raison).toContain('lecture seule')
  })

  it('cède au compteur du jour', () => {
    const issue = proposerActionMeta(
      constat({ type: 'pause-annonce', annonce: 'a1' }),
      contexte(),
      cadre({ faitesAujourdhui: 5 }),
    )
    expect(issue.etat).toBe('refusee')
  })
})

describe('un constat sans geste', () => {
  it('ne propose rien plutôt que de supposer', () => {
    expect(proposerActionMeta(constat({}), contexte(), cadre()).etat).toBe('aucune')
    expect(proposerActionMeta(constat({ type: 'inconnu' }), contexte(), cadre()).etat).toBe('aucune')
  })

  it('ne propose rien quand la cible a disparu depuis', () => {
    const issue = proposerActionMeta(
      constat({ type: 'pause-annonce', annonce: 'effacee' }),
      contexte(),
      cadre(),
    )
    expect(issue.etat).toBe('aucune')
  })
})
