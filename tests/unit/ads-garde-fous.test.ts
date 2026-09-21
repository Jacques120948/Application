import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACTIONS_PAR_JOUR,
  autorise,
  autoriseBudget,
  autoriseStatut,
  FACTEUR_MAX,
  FACTEUR_MIN,
  type Demande,
} from '@/server/ads/garde-fous'
import { PROFIL_VIDE, type ProfilAds } from '@/server/ads/profil'

/**
 * Les bornes de ce qu'Evoliia s'autorise à faire à l'argent de quelqu'un.
 *
 * C'est le seul endroit du produit où un défaut coûte de l'argent réel dans la minute — pas
 * des crédits, pas une facture d'API : la dépense publicitaire d'un commerçant. Chaque borne
 * est donc vérifiée sur sa raison d'être, et non seulement sur son chiffre.
 */

const MICROS = 1_000_000

function demande(champs: Partial<Demande> = {}, profil: Partial<ProfilAds> = {}): Demande {
  return {
    mode: 'assiste',
    devise: 'CHF',
    profil: { ...PROFIL_VIDE, ...profil },
    faitesAujourdhui: 0,
    ...champs,
  }
}

describe('le mode du compte', () => {
  it('interdit toute écriture en lecture seule', () => {
    /*
     * La portée Google donne la lecture et l'écriture d'un seul coup. Ce réglage est le
     * seul endroit d'Evoliia où la distinction existe, et il part fermé.
     */
    expect(autorise(demande({ mode: 'lecture' })).ok).toBe(false)
    expect(autoriseBudget(demande({ mode: 'lecture' }), 15 * MICROS, 18 * MICROS, 1).ok).toBe(false)
    expect(autoriseStatut(demande({ mode: 'lecture' }), 'PAUSED').ok).toBe(false)
  })

  it('ne connaît pas l’autopilote', () => {
    // Un mode inconnu ne vaut pas « assisté » : il ne vaut rien.
    expect(autorise(demande({ mode: 'autopilote' })).ok).toBe(false)
  })
})

describe('la vitesse', () => {
  it('borne le nombre de gestes par jour', () => {
    expect(autorise(demande({ faitesAujourdhui: ACTIONS_PAR_JOUR })).ok).toBe(false)
    expect(autorise(demande({ faitesAujourdhui: ACTIONS_PAR_JOUR - 1 })).ok).toBe(true)
  })

  it('laisse toujours passer une mise en pause', () => {
    /*
     * Une pause arrête une dépense. Refuser d'arrêter une campagne qui brûle de l'argent au
     * motif qu'on a déjà fait cinq gestes serait le contraire de ce que ces bornes protègent.
     */
    const sature = demande({ faitesAujourdhui: ACTIONS_PAR_JOUR + 10 })
    expect(autoriseStatut(sature, 'PAUSED').ok).toBe(true)
    // Reprendre une diffusion, en revanche, dépense : la borne s'applique.
    expect(autoriseStatut(sature, 'ENABLED').ok).toBe(false)
  })
})

describe('le budget partagé', () => {
  it('refuse d’y toucher', () => {
    /*
     * Chez Google, un budget est un objet à part qui peut servir plusieurs campagnes. Le
     * modifier pour l'une augmenterait, en silence, la dépense de celles qu'on ne regardait
     * pas.
     */
    const verdict = autoriseBudget(demande(), 15 * MICROS, 18 * MICROS, 3)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('partagé')
  })
})

describe('l’amplitude d’un budget', () => {
  it('accepte un pas raisonnable dans les deux sens', () => {
    expect(autoriseBudget(demande(), 20 * MICROS, 28 * MICROS, 1).ok).toBe(true)
    expect(autoriseBudget(demande(), 20 * MICROS, 12 * MICROS, 1).ok).toBe(true)
  })

  it('refuse de multiplier ou de diviser d’un coup', () => {
    expect(autoriseBudget(demande(), 20 * MICROS, 20 * FACTEUR_MAX * MICROS + 1, 1).ok).toBe(false)
    expect(autoriseBudget(demande(), 20 * MICROS, 20 * FACTEUR_MIN * MICROS - 1, 1).ok).toBe(false)
    expect(autoriseBudget(demande(), 20 * MICROS, 200 * MICROS, 1).ok).toBe(false)
    expect(autoriseBudget(demande(), 20 * MICROS, 1 * MICROS, 1).ok).toBe(false)
  })

  it('refuse un montant nul ou absurde', () => {
    expect(autoriseBudget(demande(), 20 * MICROS, 0, 1).ok).toBe(false)
    expect(autoriseBudget(demande(), 20 * MICROS, Number.NaN, 1).ok).toBe(false)
    // Sans budget connu, aucun pas ne peut être jugé raisonnable.
    expect(autoriseBudget(demande(), 0, 10 * MICROS, 1).ok).toBe(false)
  })

  it('plafonne au budget mensuel, quand il est renseigné', () => {
    /*
     * Sans ce plafond, une suite de hausses de moitié ferait tripler la dépense d'un mois
     * en trois gestes, chacun pris isolément raisonnable.
     */
    const avec = demande({}, { budgetMensuel: 300 })
    // 300 / 30 × 2 = 20 CHF par jour au maximum pour une campagne.
    expect(autoriseBudget(avec, 18 * MICROS, 20 * MICROS, 1).ok).toBe(true)
    const trop = autoriseBudget(avec, 18 * MICROS, 26 * MICROS, 1)
    expect(trop.ok).toBe(false)
    if (!trop.ok) expect(trop.raison).toContain('plafond')
  })

  it('n’invente pas de plafond quand le budget mensuel est vide', () => {
    // Sans chiffre de la personne, décider à sa place de ce qu'elle peut dépenser.
    expect(autoriseBudget(demande(), 100 * MICROS, 140 * MICROS, 1).ok).toBe(true)
  })
})

describe('le statut', () => {
  it('ne connaît que la pause et la reprise', () => {
    expect(autoriseStatut(demande(), 'REMOVED').ok).toBe(false)
    expect(autoriseStatut(demande(), 'ENABLED').ok).toBe(true)
  })
})

describe('l’architecture de l’écriture', () => {
  it('garde le connecteur de lecture incapable d’écrire', () => {
    /*
     * La garantie ne peut pas venir de Google : la portée `adwords` ouvre l'écriture et il
     * n'en existe pas de version en lecture seule. Elle vient de la séparation des deux
     * fichiers, et cette séparation ne se voit que si on la vérifie.
     */
    const lecture = readFileSync('src/server/ads/google-ads.ts', 'utf8')
    expect(lecture).not.toContain(':mutate')
  })

  it('n’appelle le connecteur d’écriture que depuis le journal', () => {
    /*
     * La propriété qui rend le retour arrière possible : la valeur d'avant est écrite avant
     * l'envoi. Un second appelant pourrait envoyer une modification sans laisser de trace,
     * et personne ne s'en apercevrait avant le relevé du mois.
     */
    const fichiers = [
      'src/server/ads/actions.ts',
      'src/server/ads/synchro.ts',
      'src/server/ads/comptes.ts',
      'src/server/ads/recommandations.ts',
      'src/server/ads/tableau.ts',
      'src/server/ads/profil.ts',
      'src/server/ads/contexte.ts',
      'src/server/ads/regles.ts',
    ]
    const appelants = fichiers.filter((chemin) =>
      readFileSync(chemin, 'utf8').includes('google-ads-ecriture'),
    )
    expect(appelants).toEqual(['src/server/ads/actions.ts'])
  })

  it('écrit le journal avant d’envoyer', () => {
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    const creation = source.indexOf('tx.adsAction.create')
    const envoi = source.indexOf('const issue = await envoi()')
    expect(creation).toBeGreaterThan(0)
    expect(envoi).toBeGreaterThan(creation)
  })

  it('n’expose aucun chemin qui agisse sans qu’une personne ait cliqué', () => {
    /*
     * Il n'y a pas d'autopilote parce qu'il n'y a rien pour l'appeler : aucune tournée
     * nocturne n'importe le module d'écriture.
     */
    const nuit = readFileSync('src/server/audit/automatisation.ts', 'utf8')
    expect(nuit).not.toContain('appliquerBudget')
    expect(nuit).not.toContain('appliquerStatut')
    expect(nuit).not.toContain('google-ads-ecriture')
  })
})
