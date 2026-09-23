import { describe, expect, it } from 'vitest'
import { lireLigneClient } from '@/server/integrations/providers/shopify-clients'
import { agregerPaniers } from '@/server/lina/collecte'
import { CRITERES_DEFAUT, criteresSchema, lireCriteres } from '@/server/lina/criteres'
import { campagnes, insights, quickWins, santeCrm, TAUX_HYPOTHESE } from '@/server/lina/recommandations'
import {
  appartient,
  classeRfm,
  contexteSegments,
  indicateurs,
  rfm,
  segmenter,
  type ClientIndex,
} from '@/server/lina/segments'
import { faitsLina } from '@/server/lina/contexte'
import { LINA_SYSTEM } from '@/server/ai/prompts'
import { findVisibilityAgent } from '@/server/agents/visibility'
import { membre, ecranDuMembre } from '@/lib/equipe'

const MAINTENANT = new Date('2026-09-23T12:00:00Z')
const JOUR = 24 * 60 * 60 * 1000
const ilYA = (jours: number) => new Date(+MAINTENANT - jours * JOUR)

let numero = 0
function client(partiel: Partial<ClientIndex> & { dernier?: number | null; cree?: number }): ClientIndex {
  numero += 1
  const { dernier = 10, cree = 400, ...reste } = partiel
  return {
    ref: String(numero),
    creeLe: ilYA(cree),
    derniereCommande: dernier === null ? null : ilYA(dernier),
    commandes: 1,
    caCents: 5_000,
    consentement: 'oui',
    ...reste,
  }
}

/** Une petite boutique : de quoi remplir chaque segment sans en fabriquer à la main. */
function boutique(): ClientIndex[] {
  return [
    // 30 clients d'une seule commande, récents
    ...Array.from({ length: 30 }, () => client({ dernier: 20, cree: 20 })),
    // 30 récurrents actifs
    ...Array.from({ length: 30 }, () => client({ commandes: 3, caCents: 24_000, dernier: 30, cree: 300 })),
    // 25 à réactiver (120 jours), dont la moitié sans consentement
    ...Array.from({ length: 25 }, (_, i) => client({ dernier: 120, cree: 400, consentement: i % 2 === 0 ? 'oui' : 'non' })),
    // 20 dormants (300 jours), CA historique 10 000 chacun
    ...Array.from({ length: 20 }, () => client({ commandes: 2, caCents: 10_000, dernier: 300, cree: 500 })),
    // 5 très gros clients
    ...Array.from({ length: 5 }, () => client({ commandes: 8, caCents: 200_000, dernier: 15, cree: 700 })),
    // 10 inscrits sans commande
    ...Array.from({ length: 10 }, () => client({ commandes: 0, caCents: 0, dernier: null, cree: 50, consentement: 'sans-email' })),
  ]
}

describe('Lina — identité', () => {
  it('rejoint l’équipe, avec son portrait, sa fonction et son écran', () => {
    expect(membre('lina')).toMatchObject({ name: 'Lina', role: 'CRM & Fidélisation', avatar: '/equipe/lina.webp' })
    expect(ecranDuMembre('lina', 'fr', '').href).toBe('/fr/lina')
    expect(findVisibilityAgent('lina')).toMatchObject({ feature: 'lina_agent', summary: 'Lina transforme vos clients existants en clients plus fidèles et plus rentables.' })
  })

  it('a des règles qui interdisent d’inventer et de contacter sans consentement', () => {
    expect(LINA_SYSTEM).toContain('Tu ne calcules rien')
    expect(LINA_SYSTEM).toMatch(/Consentement d.abord/u)
    expect(LINA_SYSTEM).toContain('Pas de remise par réflexe')
    expect(LINA_SYSTEM).toMatch(/aucune donnée personnelle/u)
  })
})

describe('Lina — lecture de l’export Shopify', () => {
  it('ne garde d’un client que des dates, des montants et son consentement', () => {
    const ligne = JSON.stringify({
      id: 'gid://shopify/Customer/42',
      createdAt: '2025-01-02T10:00:00Z',
      numberOfOrders: '3',
      amountSpent: { amount: '123.45', currencyCode: 'CHF' },
      lastOrder: { createdAt: '2026-08-01T09:00:00Z' },
      defaultEmailAddress: { marketingState: 'SUBSCRIBED' },
      email: 'ne-doit-pas-passer@exemple.ch',
      firstName: 'Ne doit pas passer',
    })
    const lu = lireLigneClient(ligne, true)
    expect(lu).toEqual({
      ref: '42',
      creeLe: '2025-01-02T10:00:00Z',
      derniereCommande: '2026-08-01T09:00:00Z',
      commandes: 3,
      caCents: 12_345,
      devise: 'CHF',
      consentement: 'oui',
      consentementSms: 'inconnu',
    })
    expect(JSON.stringify(lu)).not.toMatch(/@|Ne doit/u)
  })

  it('distingue refus, absence d’email et consentement non lu', () => {
    const base = { id: 'gid://shopify/Customer/1', createdAt: '2025-01-01T00:00:00Z', numberOfOrders: 1, amountSpent: { amount: '10', currencyCode: 'CHF' } }
    expect(lireLigneClient(JSON.stringify({ ...base, defaultEmailAddress: { marketingState: 'UNSUBSCRIBED' } }), true)?.consentement).toBe('non')
    expect(lireLigneClient(JSON.stringify({ ...base, defaultEmailAddress: null }), true)?.consentement).toBe('sans-email')
    expect(lireLigneClient(JSON.stringify(base), false)?.consentement).toBe('inconnu')
    expect(lireLigneClient('{"id":"gid://shopify/Order/1"}', true)).toBeNull()
    expect(lireLigneClient('pas du json', true)).toBeNull()
  })

  it('réduit les paniers abandonnés à des totaux sur deux périodes', () => {
    const paniers = agregerPaniers(
      [
        { creeLe: ilYA(2).toISOString(), recupere: false, totalCents: 8_000, devise: 'CHF' },
        { creeLe: ilYA(5).toISOString(), recupere: true, totalCents: 4_000, devise: 'CHF' },
        { creeLe: ilYA(45).toISOString(), recupere: false, totalCents: 6_000, devise: 'CHF' },
      ],
      MAINTENANT,
      false,
    )
    expect(paniers.courant).toEqual({ nombre: 2, valeurCents: 12_000, recuperes: 1, valeurRecupereeCents: 4_000 })
    expect(paniers.precedent.nombre).toBe(1)
  })
})

describe('Lina — critères', () => {
  it('refuse un seuil dormant plus court que le seuil actif, et retombe sur les défauts', () => {
    expect(criteresSchema.safeParse({ ...CRITERES_DEFAUT, dormantJours: 60 }).success).toBe(false)
    expect(lireCriteres({ actifJours: 'n’importe quoi' })).toEqual(CRITERES_DEFAUT)
    expect(lireCriteres({ actifJours: 60 }).actifJours).toBe(60)
  })
})

describe('Lina — segments', () => {
  const clients = boutique()
  const contexte = contexteSegments(clients, CRITERES_DEFAUT, MAINTENANT)
  const segments = segmenter(clients, contexte, true, 'CHF')
  const trouver = (cle: string) => segments.find((segment) => segment.cle === cle)!

  it('compte chaque segment sur les vraies données', () => {
    expect(trouver('une-fois').nombre).toBe(55)
    expect(trouver('recurrents').nombre).toBe(55)
    expect(trouver('a-reactiver').nombre).toBe(25)
    expect(trouver('dormants').nombre).toBe(20)
    expect(trouver('dormants').caCents).toBe(200_000)
    expect(trouver('sans-commande').nombre).toBe(10)
    expect(trouver('nouveaux').nombre).toBe(30)
    expect(trouver('fideles').nombre).toBe(35)
  })

  it('reconnaît les VIP par rapport à la boutique elle-même', () => {
    expect(contexte.seuilVipCents).toBe(200_000)
    expect(trouver('vip').nombre).toBe(5)
    expect(trouver('vip').partCa).toBeCloseTo(1_000_000 / 2_195_000, 5)
  })

  it('compte les joignables par email, et dit « à vérifier » sans consentement lu', () => {
    expect(trouver('a-reactiver').contactables).toBe(13)
    expect(segmenter(clients, contexte, false, 'CHF').find((segment) => segment.cle === 'a-reactiver')!.contactables).toBeNull()
  })

  it('donne la requête à coller dans Shopify', () => {
    expect(trouver('dormants').requeteShopify).toBe('last_order_date < -180d')
    expect(trouver('a-reactiver').requeteShopify).toBe('last_order_date BETWEEN -180d AND -90d')
  })

  it('repère un client régulier au silence inhabituel, sans l’appeler perdu', () => {
    // Commande tous les 30 jours depuis un an, rien depuis 70 jours.
    const regulier = client({ commandes: 12, caCents: 60_000, cree: 400, dernier: 70 })
    expect(appartient(regulier, 'a-risque', contexte)).toBe(true)
    expect(appartient(client({ commandes: 12, cree: 400, dernier: 20 }), 'a-risque', contexte)).toBe(false)
    expect(trouver('a-risque').critere).toContain('risque estimé')
  })

  it('calcule le taux de réachat et la part du CA des récurrents', () => {
    const i = indicateurs(clients, segments, true)
    expect(i.acheteurs).toBe(110)
    expect(i.tauxReachat).toBe(0.5)
    expect(i.sansEmail).toBe(10)
  })

  it('n’établit pas de RFM sous 50 acheteurs, et range les champions', () => {
    expect(rfm(clients.slice(0, 20), MAINTENANT)).toBeNull()
    expect(rfm(clients, MAINTENANT)?.map((ligne) => ligne.cle)).toContain('champions')
    expect(classeRfm({ r: 1, f: 1, m: 1 })).toBe('dormants')
    expect(classeRfm({ r: 1, f: 4, m: 5 })).toBe('a-risque')
  })
})

describe('Lina — recommandations', () => {
  const clients = boutique()
  const contexte = contexteSegments(clients, CRITERES_DEFAUT, MAINTENANT)
  const segments = segmenter(clients, contexte, true, 'CHF')
  const i = indicateurs(clients, segments, true)
  const paniers = agregerPaniers(
    Array.from({ length: 12 }, (_, n) => ({ creeLe: ilYA(3).toISOString(), recupere: n < 2, totalCents: 9_000, devise: 'CHF' })),
    MAINTENANT,
    false,
  )
  const liste = campagnes(segments, i, paniers, CRITERES_DEFAUT, 'CHF')

  it('propose des campagnes avec audience, objectif, message, timing, canal, impact et effort', () => {
    const reactivation = liste.find((campagne) => campagne.cle === 'reactivation')!
    expect(reactivation).toMatchObject({ audience: 13, canal: 'Email', effort: 'faible' })
    expect(reactivation.requeteShopify).toContain("email_subscription_status = 'SUBSCRIBED'")
    expect(reactivation.hypothese).toContain('pas une prévision')
    expect(liste.every((campagne) => campagne.objectif !== '' && campagne.timing !== '' && campagne.message !== '')).toBe(true)
  })

  it('relance les paniers en trois temps, sans remise par défaut', () => {
    const panier = liste.find((campagne) => campagne.cle === 'panier-abandonne')!
    expect(panier.audience).toBe(10)
    expect(panier.etapes).toHaveLength(3)
    expect(panier.remise).toContain('Sans remise')
    expect(panier.potentielCents).toBe(Math.round(10 * TAUX_HYPOTHESE['panier-abandonne'] * 9_000))
  })

  it('ne propose jamais d’écrire à personne', () => {
    const sansConsentement = boutique().map((un) => ({ ...un, consentement: 'non' }))
    const ctx = contexteSegments(sansConsentement, CRITERES_DEFAUT, MAINTENANT)
    const segs = segmenter(sansConsentement, ctx, true, 'CHF')
    const campagnesSans = campagnes(segs, indicateurs(sansConsentement, segs, true), null, CRITERES_DEFAUT, 'CHF')
    expect(campagnesSans).toHaveLength(0)
  })

  it('limite les constats à cinq et les gains rapides à cinq', () => {
    const constats = insights(segments, i, paniers, CRITERES_DEFAUT, 'CHF')
    expect(constats.length).toBeLessThanOrEqual(5)
    expect(constats.map((un) => un.cle)).toContain('dormants')
    expect(constats.find((un) => un.cle === 'dormants')!.texte).toContain('CHF 2')
    expect(quickWins(liste).length).toBeLessThanOrEqual(5)
  })

  it('signale une base sans consentement lu et un historique insuffisant', () => {
    const lignes = santeCrm(segments, { ...i, acheteurs: 30 }, null, { clients: 120, tronque: false, consentement: false, plusAncien: ilYA(100), maintenant: MAINTENANT })
    expect(lignes.map((ligne) => ligne.cle)).toEqual(expect.arrayContaining(['consentement', 'historique', 'paniers']))
  })
})

describe('Lina — ce que le modèle reçoit', () => {
  it('des segments et des totaux, jamais un identifiant de client', () => {
    const clients = boutique()
    const contexte = contexteSegments(clients, CRITERES_DEFAUT, MAINTENANT)
    const segments = segmenter(clients, contexte, true, 'CHF')
    const ind = indicateurs(clients, segments, true)
    const faits = faitsLina({
      etat: { etat: 'ok', source: 'shopify', sansClient: 0, commandesEnCours: false, commandesAt: null, commandesMessage: '', analyse: null, message: '', boutique: 'demo.myshopify.com', synchroAt: MAINTENANT, lanceAt: null, clients: clients.length, tronque: false, consentement: true, consentementSms: false, paniers: null },
      criteres: CRITERES_DEFAUT,
      activite: 'ecommerce',
      devise: 'CHF',
      vierge: false,
      indicateurs: ind,
      segments,
      rfm: null,
      campagnes: campagnes(segments, ind, null, CRITERES_DEFAUT, 'CHF'),
      insights: [],
      quickWins: [],
      sante: [],
      paniers: null,
      topSegment: null,
      nova: null,
      pourOria: [],
      analyse: null,
      produits: [],
      reachat: [],
      croisees: [],
      montees: [],
      valeur: null,
      risques: [],
      fidelite: [],
      audiences: [],
      scenarios: [],
      produitsSegments: {},
      releve: null,
      releves: [],
      bilan: null,
      alertes: [],
      score: null,
      objectifs: { tauxReachat: null, caExistants30: null, reactives30: null, valeurClient: null, score: null },
      progression: [],
      pistesServices: [],
    }).join('\n')
    expect(faits).toContain('Clients dormants')
    expect(faits).not.toMatch(/demo\.myshopify|Client n°|gid:\/\//u)
    for (const un of clients) expect(faits).not.toContain(`n° ${un.ref}`)
  })
})
