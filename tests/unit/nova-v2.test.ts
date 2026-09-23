import { describe, expect, it } from 'vitest'
import { margeEstimee, ordreIndicateurs, suivreObjectifs } from '@/server/nova/pilotage'
import { lectureParcours, modelesAttribution, repartitionClients, valeurClient } from '@/server/nova/clients'
import { instantaneClients } from '@/server/nova/agregat'
import { semainePassee } from '@/server/nova/bilan'
import { lireReglages, reglagesSchema } from '@/server/nova/reglages'
import type { CumulVentes } from '@/server/nova/metriques'
import type { CommandeShopify } from '@/server/integrations/providers/shopify'

function ventes(partiel: Partial<CumulVentes> = {}): CumulVentes {
  return {
    commandes: 100,
    chiffre: 10_000,
    nouveauxClients: 40,
    chiffreNouveaux: 3_600,
    clientsIdentifies: 90,
    canaux: {},
    canauxPremier: {},
    produits: [],
    couts: null,
    ...partiel,
  }
}

describe('Nova V2 — marge', () => {
  it('n’estime rien sans le coût des produits', () => {
    expect(margeEstimee(ventes(), 1_000, {})).toMatchObject({ etat: 'impossible' })
    expect(margeEstimee(null, 1_000, { coutProduitPct: 40 })).toMatchObject({ etat: 'impossible' })
  })

  it('soustrait chaque coût renseigné et nomme ceux qui manquent', () => {
    const marge = margeEstimee(ventes(), 1_000, { coutProduitPct: 40, livraisonParCommande: 5, paiementPct: 2, paiementFixe: 0.3 })
    expect(marge.etat).toBe('calculee')
    if (marge.etat !== 'calculee') return
    // 10 000 − 4 000 produits − 500 livraison − 230 paiement − 1 000 publicité
    expect(marge.marge).toBe(4_270)
    expect(marge.taux).toBeCloseTo(0.427, 3)
    expect(marge.manquants).toEqual(['commissions', 'autres coûts variables'])
  })
})

describe('Nova V2 — objectifs', () => {
  const mesure = { mois: { joursEcoules: 15, joursDuMois: 30 }, ventesMois: ventes({ chiffre: 12_000, commandes: 60 }), roas30: 280, cac30: 35 }

  it('projette le mois au rythme actuel, et le dit', () => {
    const [ca] = suivreObjectifs({ caMensuel: 30_000 }, mesure)
    expect(ca).toMatchObject({ actuel: 12_000, projection: 24_000, tendance: 'en-retard' })
    expect(ca!.commentaire).toContain('pas une prévision')
  })

  it('ne projette pas trop tôt dans le mois', () => {
    const [ca] = suivreObjectifs({ caMensuel: 30_000 }, { ...mesure, mois: { joursEcoules: 3, joursDuMois: 30 } })
    expect(ca).toMatchObject({ projection: null, tendance: 'inconnue' })
  })

  it('juge un plancher de ROAS et un plafond de CAC dans le bon sens', () => {
    const suivis = suivreObjectifs({ roasMin: 300, cacMax: 30 }, mesure)
    expect(suivis.find((un) => un.cle === 'roasMin')).toMatchObject({ tendance: 'hors-cible' })
    const cac = suivis.find((un) => un.cle === 'cacMax')
    expect(cac).toMatchObject({ tendance: 'hors-cible' })
    expect(cac!.ecart).toBeLessThan(0)
    expect(suivreObjectifs({ cacMax: 30 }, { ...mesure, cac30: null })[0]).toMatchObject({ tendance: 'inconnue' })
  })

  it('met en avant d’autres chiffres selon l’activité', () => {
    expect(ordreIndicateurs('ecommerce')[0]).toBe('chiffre')
    // V6 : une activité de services regarde d'abord ses prospects et ce qu'ils coûtent.
    expect(ordreIndicateurs('services').slice(0, 2)).toEqual(['leads', 'cpl'])
  })
})

describe('Nova V2 — réglages', () => {
  it('refuse l’absurde et relit sans casser le reste', () => {
    expect(reglagesSchema.safeParse({ activite: 'ecommerce', objectifs: {}, couts: { coutProduitPct: 140 } }).success).toBe(false)
    expect(reglagesSchema.safeParse({ activite: 'ecommerce', objectifs: { cacMax: -5 }, couts: {} }).success).toBe(false)
    expect(lireReglages({ activite: 'n’importe', objectifs: { caMensuel: 'beaucoup' }, couts: { coutProduitPct: 35 } })).toEqual({
      activite: '',
      objectifs: {},
      couts: { coutProduitPct: 35 },
    })
  })
})

function commande(clientId: string | null, totalCents = 5_000): CommandeShopify {
  return {
    id: 'x',
    creeLe: '2026-09-20T10:00:00Z',
    totalCents,
    devise: 'CHF',
    annulee: false,
    test: false,
    premiere: null,
    visite: null,
    premiereVisite: null,
    clientId,
    lignes: [],
  }
}

describe('Nova V2 — clients', () => {
  it('compte les clients distincts sans garder d’identifiant', () => {
    const instantane = instantaneClients([commande('a'), commande('a'), commande('b'), commande(null)], '2026-06-25', '2026-09-22')
    expect(instantane).toEqual({ au: '2026-09-22', depuis: '2026-06-25', clients: 2, recurrents: 1, commandes: 3, chiffreCents: 15_000 })
    expect(JSON.stringify(instantane)).not.toMatch(/"a"|"b"/)
  })

  it('ne calcule pas de valeur client sur une poignée de clients, et ne l’appelle pas LTV', () => {
    expect(valeurClient(null).etat).toBe('insuffisant')
    expect(valeurClient({ au: 'x', depuis: 'y', clients: 5, recurrents: 1, commandes: 6, chiffreCents: 60_000 }).etat).toBe('insuffisant')
    expect(valeurClient({ au: 'x', depuis: 'y', clients: 40, recurrents: 10, commandes: 60, chiffreCents: 600_000 })).toMatchObject({
      etat: 'calculee',
      valeur: 150,
      commandesParClient: 1.5,
      tauxRetour: 0.25,
    })
  })

  it('sépare nouveaux, revenus et inconnus', () => {
    expect(repartitionClients(ventes())).toMatchObject({
      nouveaux: { commandes: 40, chiffre: 3_600 },
      existants: { commandes: 50 },
      inconnus: { commandes: 10 },
      autresChiffre: 6_400,
    })
  })
})

describe('Nova V2 — attribution et parcours', () => {
  const avecParcours = ventes({
    canaux: {
      'google-ads': { commandes: 20, chiffre: 2_000, origines: {} },
      'meta-ads': { commandes: 4, chiffre: 400, origines: {} },
    },
    canauxPremier: {
      'google-ads': { commandes: 6, chiffre: 600, origines: {} },
      'meta-ads': { commandes: 18, chiffre: 1_800, origines: {} },
    },
  })

  it('partage chaque vente pour moitié entre premier et dernier contact', () => {
    const lignes = modelesAttribution(avecParcours)!
    const meta = lignes.find((ligne) => ligne.canal === 'meta-ads')!
    expect(meta.chiffre).toEqual({ dernier: 400, premier: 1_800, partage: 1_100 })
  })

  it('n’affiche aucun modèle tant que le premier contact est inconnu', () => {
    expect(modelesAttribution(ventes({ canaux: { direct: { commandes: 5, chiffre: 100, origines: {} } } }))).toBeNull()
  })

  it('lit le rôle de chaque canal comme une interprétation', () => {
    const phrases = lectureParcours(modelesAttribution(avecParcours))
    expect(phrases).toContain('Meta Ads semble surtout intervenir en début de parcours : premier contact de 18 commandes, dernier de 4.')
    expect(phrases.some((phrase) => phrase.startsWith('Google Ads semble intervenir plus près de l’achat'))).toBe(true)
  })
})

describe('Nova V2 — bilan', () => {
  it('prend la dernière semaine terminée, du lundi au dimanche', () => {
    // Le mercredi 23 septembre 2026 : la semaine du 14 au 20.
    expect(semainePassee('2026-09-23')).toEqual({ du: '2026-09-14', au: '2026-09-20' })
    // Un lundi : la semaine qui vient de finir la veille.
    expect(semainePassee('2026-09-21')).toEqual({ du: '2026-09-14', au: '2026-09-20' })
    // Un dimanche : la semaine en cours n'est pas terminée.
    expect(semainePassee('2026-09-20')).toEqual({ du: '2026-09-07', au: '2026-09-13' })
  })
})
