import { describe, expect, it } from 'vitest'
import { assistantDe, canalDeVisite, normaliserSource } from '@/server/nova/canaux'
import { agregerCommandes } from '@/server/nova/agregat'
import {
  attribution,
  cumulVentes,
  ensemble,
  indicateursNova,
  MANQUE_CAC,
  MANQUE_CONVERSION,
  performanceCampagnes,
  periodeDe,
  periodePrecedente,
  type Donnees,
  type JourCampagne,
  type JourVentes,
} from '@/server/nova/metriques'
import { detecterAlertes, detecterInsights, detecterOpportunites, type Contexte } from '@/server/nova/analyse'
import type { CommandeShopify, VisiteShopify } from '@/server/integrations/providers/shopify'

function visite(partiel: { source?: string; referrer?: string; utm?: Partial<VisiteShopify['utm']> }): VisiteShopify {
  return {
    source: partiel.source ?? '',
    referrer: partiel.referrer ?? '',
    utm: { source: '', medium: '', campaign: '', content: '', term: '', ...partiel.utm },
  }
}

describe('Nova — normalisation des sources', () => {
  it('regroupe les étiquettes d’une même source sans perdre l’originale', () => {
    for (const brut of ['facebook', 'Facebook', 'fb', 'meta', 'IG', 'instagram']) expect(normaliserSource(brut)).toBe('meta')
    expect(normaliserSource('Google')).toBe('google')
    const payant = canalDeVisite(visite({ utm: { source: 'Facebook', medium: 'cpc' } }))
    expect(payant).toMatchObject({ canal: 'meta-ads', origine: 'Facebook / cpc' })
  })

  it('ne range en publicité que sur un indice explicite', () => {
    // Un lien Facebook partagé n'est pas une annonce.
    expect(canalDeVisite(visite({ referrer: 'https://l.facebook.com/l.php?u=x' })).canal).toBe('social')
    expect(canalDeVisite(visite({ referrer: 'https://www.google.com/?gclid=abc' })).canal).toBe('google-ads')
    expect(canalDeVisite(visite({ utm: { source: 'google', medium: 'cpc' } })).canal).toBe('google-ads')
    expect(canalDeVisite(visite({ referrer: 'https://www.google.com/' })).canal).toBe('seo')
  })

  it('reconnaît les assistants IA, y compris Gemini qui est chez Google', () => {
    expect(canalDeVisite(visite({ utm: { source: 'chatgpt.com' } }))).toMatchObject({ canal: 'ia', assistant: 'ChatGPT' })
    expect(canalDeVisite(visite({ referrer: 'https://www.perplexity.ai/search' })).assistant).toBe('Perplexity')
    expect(canalDeVisite(visite({ referrer: 'https://gemini.google.com/app' })).canal).toBe('ia')
    expect(assistantDe('copilot.microsoft.com', '')).toBe('Copilot')
  })

  it('distingue direct, e-mail, référent, autre et inconnu', () => {
    expect(canalDeVisite(visite({})).canal).toBe('direct')
    expect(canalDeVisite(visite({ utm: { source: 'klaviyo', medium: 'email' } })).canal).toBe('email')
    expect(canalDeVisite(visite({ referrer: 'https://blog-ami.ch/article' })).canal).toBe('referral')
    expect(canalDeVisite(visite({ utm: { source: 'partenaire-x' } })).canal).toBe('autres')
    expect(canalDeVisite(null).canal).toBe('inconnu')
  })
})

function commande(partiel: Partial<CommandeShopify>): CommandeShopify {
  return {
    id: partiel.id ?? 'gid://shopify/Order/1',
    creeLe: partiel.creeLe ?? '2026-09-20T10:00:00Z',
    totalCents: partiel.totalCents ?? 10_000,
    devise: 'CHF',
    annulee: partiel.annulee ?? false,
    test: partiel.test ?? false,
    premiere: partiel.premiere ?? null,
    visite: partiel.visite ?? null,
    lignes: partiel.lignes ?? [],
  }
}

describe('Nova — agrégation des commandes', () => {
  it('range par jour dans le fuseau de la boutique, sans test ni annulation', () => {
    const jours = agregerCommandes(
      [
        // 21 h 30 UTC : 23 h 30 à Zurich, encore le 20. 22 h 30 UTC : déjà le 21 pour la boutique.
        commande({ creeLe: '2026-09-20T21:30:00Z', totalCents: 5_000, premiere: true, visite: visite({ utm: { source: 'fb', medium: 'paid' } }) }),
        commande({ creeLe: '2026-09-20T22:30:00Z', totalCents: 7_000, premiere: false }),
        commande({ creeLe: '2026-09-20T10:00:00Z', test: true }),
        commande({ creeLe: '2026-09-20T10:00:00Z', annulee: true }),
      ],
      'Europe/Zurich',
    )
    expect(jours.map((jour) => jour.jour)).toEqual(['2026-09-20', '2026-09-21'])
    expect(jours[0]).toMatchObject({ commandes: 1, chiffreCents: 5_000, nouveauxClients: 1, clientsIdentifies: 1 })
    expect(jours[0]!.canaux['meta-ads']).toMatchObject({ commandes: 1, origines: { 'fb / paid': 1 } })
    expect(jours[1]!.canaux.inconnu?.commandes).toBe(1)
  })

  it('compte une commande une fois par produit', () => {
    const [jour] = agregerCommandes(
      [
        commande({
          lignes: [
            { produitId: 'p1', titre: 'Bougie', quantite: 2, totalCents: 4_000 },
            { produitId: 'p1', titre: 'Bougie', quantite: 1, totalCents: 2_000 },
          ],
        }),
      ],
      'UTC',
    )
    expect(jour!.produits).toEqual([{ id: 'p1', titre: 'Bougie', commandes: 1, quantite: 3, chiffreCents: 6_000 }])
  })
})

describe('Nova — périodes', () => {
  it('s’arrête hier, sauf « aujourd’hui », et compare à la même durée juste avant', () => {
    const p = periodeDe('7', '2026-09-23')
    expect(p).toMatchObject({ du: '2026-09-16', au: '2026-09-22', jours: 7 })
    expect(periodePrecedente(p)).toEqual({ du: '2026-09-09', au: '2026-09-15' })
    expect(periodeDe('aujourdhui', '2026-09-23')).toMatchObject({ du: '2026-09-23', au: '2026-09-23' })
    expect(periodeDe('n’importe quoi', '2026-09-23').jours).toBe(30)
  })

  it('borne une période personnalisée et refuse l’absurde', () => {
    expect(periodeDe('perso', '2026-09-23', '2026-09-01', '2026-12-31')).toMatchObject({ au: '2026-09-23', jours: 23 })
    expect(periodeDe('perso', '2026-09-23', '2026-09-10', '2026-09-01').jours).toBe(30)
    expect(periodeDe('perso', '2026-09-23', '2020-01-01', '2026-09-01').jours).toBe(30)
  })
})

function jourCampagne(partiel: Partial<JourCampagne> & Pick<JourCampagne, 'plateforme' | 'jour'>): JourCampagne {
  return { campagneId: 'c1', nom: 'Campagne', depense: 0, clics: 0, impressions: 0, conversions: 0, valeur: 0, ...partiel }
}

function jourVentes(partiel: Partial<JourVentes> & Pick<JourVentes, 'jour'>): JourVentes {
  return { commandes: 0, chiffre: 0, nouveauxClients: 0, clientsIdentifies: 0, canaux: {}, produits: [], ...partiel }
}

/** L'exemple du cahier des charges : Google 1 500 → 6 000, Meta 2 500 → 6 500, Shopify 11 000. */
function exemple(): Donnees {
  return {
    devise: 'CHF',
    regies: ['google-ads', 'meta-ads'],
    campagnes: [
      jourCampagne({ plateforme: 'google-ads', jour: '2026-09-10', depense: 1_500, conversions: 31, valeur: 6_000, clics: 900 }),
      jourCampagne({ plateforme: 'meta-ads', campagneId: 'm1', jour: '2026-09-10', depense: 2_500, conversions: 42, valeur: 6_500, clics: 1_400 }),
    ],
    ventes: {
      disponibles: true,
      couvertureDepuis: '2026-07-01',
      jours: [jourVentes({ jour: '2026-09-10', commandes: 58, chiffre: 11_000, nouveauxClients: 40, clientsIdentifies: 58 })],
    },
    recherche: null,
  }
}

describe('Nova — indicateurs et attribution', () => {
  const periode = periodeDe('30', '2026-09-23')

  it('n’additionne jamais les revenus des régies au chiffre d’affaires', () => {
    const donnees = exemple()
    const vue = attribution(donnees, periode, cumulVentes(donnees.ventes, periode))
    expect(vue.revendique).toBe(12_500)
    expect(vue.reel).toEqual({ commandes: 58, chiffre: 11_000 })
    expect(vue.chevauchement).toBe(true)
    expect(vue.explication).toContain('revendiquent ensemble CHF 12')
    expect(vue.explication).toContain('Shopify enregistre CHF 11')
    expect(vue.explication).toContain('chevauchement d’attribution')
    expect(vue.modele).toContain('dernier clic')
  })

  it('calcule ROAS, MER, CAC et panier sans les confondre', () => {
    const donnees = exemple()
    const kpis = Object.fromEntries(
      indicateursNova(ensemble(donnees, periode), ensemble(donnees, periodePrecedente(periode))).map((kpi) => [kpi.cle, kpi]),
    )
    expect(kpis.chiffre!.valeur).toBe(11_000)
    expect(kpis.depenses!.valeur).toBe(4_000)
    expect(kpis.roas!.valeur).toBe(313) // 12 500 déclarés ÷ 4 000
    expect(kpis.mer!.valeur).toBe(275) // 11 000 encaissés ÷ 4 000
    expect(kpis.commandes!.valeur).toBe(58)
    expect(kpis.cac!.valeur).toBe(100) // 4 000 ÷ 40 nouveaux clients
    expect(kpis.panier!.valeur).toBeCloseTo(189.66, 2)
    expect(kpis.conversion!.valeur).toBeNull()
    expect(kpis.conversion!.absent).toBe(MANQUE_CONVERSION)
    // Pas de période précédente couverte : aucune variation inventée.
    expect(kpis.chiffre!.variation).toBeNull()
  })

  it('sans boutique, ne remplace pas les commandes par la somme des conversions des régies', () => {
    const donnees = { ...exemple(), ventes: { disponibles: false, couvertureDepuis: null, jours: [] } }
    const kpis = Object.fromEntries(indicateursNova(ensemble(donnees, periode), ensemble(donnees, periode)).map((kpi) => [kpi.cle, kpi]))
    expect(kpis.commandes!.valeur).toBeNull()
    expect(kpis.cpa!.valeur).toBeNull()
    expect(kpis.chiffre!.valeur).toBeNull()
    expect(kpis.cac!.absent).toBe(MANQUE_CAC)
    expect(kpis.roas!.valeur).toBe(313)
  })

  it('ne calcule pas le CAC sans nouveaux clients identifiés', () => {
    const donnees = exemple()
    donnees.ventes.jours = [jourVentes({ jour: '2026-09-10', commandes: 58, chiffre: 11_000 })]
    const [, , , , , , cac] = indicateursNova(ensemble(donnees, periode), ensemble(donnees, periode))
    expect(cac).toMatchObject({ cle: 'cac', valeur: null, absent: MANQUE_CAC })
  })

  it('ne somme pas une période qui commence avant les ventes connues', () => {
    const donnees = exemple()
    donnees.ventes.couvertureDepuis = '2026-09-15'
    expect(cumulVentes(donnees.ventes, periode)).toBeNull()
  })
})

function contexte(donnees: Donnees, jours = 7): Contexte {
  const periode = periodeDe(String(jours), '2026-09-23')
  const avant = periodePrecedente(periode)
  const ventes = cumulVentes(donnees.ventes, periode)
  return {
    donnees,
    bornes: periode,
    avant,
    reference: { du: '2026-08-17', au: '2026-09-15' },
    jours,
    ventes,
    ventesAvant: cumulVentes(donnees.ventes, avant),
    attribution: attribution(donnees, periode, ventes),
    campagnes: performanceCampagnes(donnees, periode, avant),
    produits: [],
  }
}

describe('Nova — alertes, insights, opportunités', () => {
  it('signale un suivi qui ne compte plus rien, pas une simple baisse', () => {
    const donnees: Donnees = {
      devise: 'CHF',
      regies: ['google-ads'],
      campagnes: [
        jourCampagne({ plateforme: 'google-ads', jour: '2026-09-10', depense: 300, conversions: 12, valeur: 900 }),
        jourCampagne({ plateforme: 'google-ads', jour: '2026-09-20', depense: 280, conversions: 0, valeur: 0 }),
      ],
      ventes: { disponibles: false, couvertureDepuis: null, jours: [] },
      recherche: null,
    }
    const [alerte] = detecterAlertes(contexte(donnees))
    expect(alerte).toMatchObject({ niveau: 'rouge', agent: 'ads' })
    expect(alerte!.texte).toContain('ne plus enregistrer correctement les conversions')
  })

  it('ne crie pas au loup sur de petits volumes', () => {
    const donnees: Donnees = {
      devise: 'CHF',
      regies: ['meta-ads'],
      campagnes: [
        jourCampagne({ plateforme: 'meta-ads', jour: '2026-09-10', depense: 20, conversions: 2, valeur: 60 }),
        jourCampagne({ plateforme: 'meta-ads', jour: '2026-09-20', depense: 60, conversions: 1, valeur: 20 }),
      ],
      ventes: { disponibles: false, couvertureDepuis: null, jours: [] },
      recherche: null,
    }
    expect(detecterAlertes(contexte(donnees))).toEqual([])
    expect(detecterInsights(contexte(donnees))).toEqual([])
  })

  it('relève la hausse du coût par conversion et le chevauchement, cinq insights au plus', () => {
    const donnees = exemple()
    donnees.campagnes.push(
      jourCampagne({ plateforme: 'meta-ads', campagneId: 'm1', jour: '2026-09-20', depense: 2_000, conversions: 20, valeur: 3_000 }),
      jourCampagne({ plateforme: 'meta-ads', campagneId: 'm1', jour: '2026-09-12', depense: 1_000, conversions: 20, valeur: 3_000 }),
      jourCampagne({ plateforme: 'google-ads', jour: '2026-09-20', depense: 500, conversions: 10, valeur: 4_000 }),
    )
    donnees.ventes.jours.push(jourVentes({ jour: '2026-09-20', commandes: 25, chiffre: 5_000 }))
    const ctx = contexte(donnees)
    const alertes = detecterAlertes(ctx)
    expect(alertes.some((alerte) => alerte.cle === 'cpa.meta-ads' && alerte.niveau === 'rouge')).toBe(true)
    const insights = detecterInsights(ctx)
    expect(insights.length).toBeLessThanOrEqual(5)
    expect(insights[0]!.cle).toBe('attribution.chevauchement')
    expect(insights.some((insight) => insight.cle === 'part.google-ads')).toBe(true)
  })

  it('confie chaque opportunité à un spécialiste, avec son écran', () => {
    const donnees = exemple()
    donnees.campagnes = [
      jourCampagne({ plateforme: 'google-ads', campagneId: 'star', nom: 'Bougies', jour: '2026-09-20', depense: 300, conversions: 20, valeur: 3_000 }),
      jourCampagne({ plateforme: 'google-ads', campagneId: 'b', nom: 'Marque', jour: '2026-09-20', depense: 900, conversions: 10, valeur: 1_000 }),
    ]
    const [opportunite] = detecterOpportunites(contexte(donnees), 'fr', 'site-1')
    expect(opportunite).toMatchObject({ agent: 'ads', impact: 'eleve' })
    expect(opportunite!.cta).toEqual({ label: 'Voir avec Naya', href: '/fr/publicite' })
  })
})
