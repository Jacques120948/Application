import { describe, expect, it } from 'vitest'
import { DEFAULT_ACTION_COSTS } from '@/server/billing/action-costs'
import { ACTION_RELEVE } from '@/server/audit/visibilite-ia'

/**
 * Le changement d'unité ne devait renchérir le relevé de personne.
 *
 * Le relevé de visibilité se facturait au forfait, à la question, toutes plateformes
 * confondues : trois crédits. Il se facture désormais par question **et par assistant**,
 * pour que chacun paie ce qu'il suit et qu'Evoliia cesse d'absorber les plateformes
 * ajoutées.
 *
 * Le piège est évident une fois écrit : reprendre le tarif de trois crédits par plateforme
 * aurait multiplié la note par trois du jour au lendemain, sans que personne ne l'ait
 * décidé — exactement ce qu'un produit ne doit jamais faire à ses clients. Un crédit par
 * assistant redonne le prix d'hier pour les trois assistants d'hier.
 *
 * Ce test ne vérifie pas un calcul, il fige une promesse commerciale.
 */

/** Ce que coûtait une question au forfait, avant que l'unité ne change. */
const FORFAIT_HISTORIQUE = 3

/** Les assistants configurés le jour du changement : Gemini, Claude, Perplexity. */
const ASSISTANTS_AVANT = 3

describe('le tarif du relevé de visibilité', () => {
  it('reproduit exactement l’ancien forfait sur trois assistants', () => {
    const ligne = DEFAULT_ACTION_COSTS.find((cout) => cout.id === ACTION_RELEVE)
    expect(ligne).toBeDefined()
    if (ligne === undefined) return

    expect(ligne.min * ASSISTANTS_AVANT).toBe(FORFAIT_HISTORIQUE)
    expect(ligne.max * ASSISTANTS_AVANT).toBe(FORFAIT_HISTORIQUE)
  })

  it('a changé d’identifiant en changeant d’unité', () => {
    /*
     * Garder « visibilite-ia » aurait fait appliquer par plateforme un prix que l'exploitant
     * avait réglé pour une question entière. Son réglage d'hier ne doit pas être relu selon
     * les règles d'aujourd'hui : c'est un prix, pas une préférence.
     */
    expect(ACTION_RELEVE).toBe('visibilite-ia-plateforme')
    expect(DEFAULT_ACTION_COSTS.some((cout) => cout.id === 'visibilite-ia')).toBe(false)
  })
})
