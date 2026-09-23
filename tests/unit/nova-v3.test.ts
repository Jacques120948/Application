import { describe, expect, it } from 'vitest'
import { canalGa4 } from '@/server/nova/canaux'
import { agregerVisites, dateGa4 } from '@/server/nova/agregat-ga4'
import { cumulVisites, periodeDe, tauxConversion, type CumulVentes, type Donnees } from '@/server/nova/metriques'
import { detecterAlertes, detecterInsights, detecterOpportunites, type Contexte } from '@/server/nova/analyse'
import { proprieteDuSite } from '@/server/nova/collecte-ga4'
import { libelleProprietes } from '@/server/integrations/providers/google-analytics'

describe('Nova V3 — canaux GA4', () => {
  it('suit le groupe de canaux de Google, avec les mêmes catégories que la boutique', () => {
    expect(canalGa4('Organic Search', 'google', 'organic').canal).toBe('seo')
    expect(canalGa4('Paid Search', 'google', 'cpc').canal).toBe('google-ads')
    expect(canalGa4('Paid Social', 'facebook', 'paid').canal).toBe('meta-ads')
    expect(canalGa4('Paid Search', 'bing', 'cpc').canal).toBe('autres')
    expect(canalGa4('Direct', '(direct)', '(none)').canal).toBe('direct')
    expect(canalGa4('Unassigned', 'x', 'y').canal).toBe('inconnu')
  })

  it('sort les assistants IA du « Referral » où Google les range', () => {
    expect(canalGa4('Referral', 'chatgpt.com', 'referral')).toMatchObject({ canal: 'ia', assistant: 'ChatGPT' })
    expect(canalGa4('Referral', 'perplexity.ai', 'referral').canal).toBe('ia')
    expect(canalGa4('Referral', 'blog-ami.ch', 'referral').canal).toBe('referral')
  })
})

describe('Nova V3 — agrégation des visites', () => {
  it('range les rapports par jour, canal et appareil', () => {
    const jours = agregerVisites(
      [
        { dimensions: ['20260920', 'Organic Search', 'google', 'organic', 'mobile'], metriques: [100, 60, 2, 150.5] },
        { dimensions: ['20260920', 'Referral', 'chatgpt.com', 'referral', 'desktop'], metriques: [10, 8, 1, 80] },
        { dimensions: ['pas-une-date', 'Direct', '(direct)', '(none)', 'mobile'], metriques: [999, 0, 0, 0] },
      ],
      [{ dimensions: ['20260920', '/bougie-citrine'], metriques: [40, 2, 150.5] }],
      [{ dimensions: ['20260920', '/bougie-citrine'], metriques: [30, 2, 150.5] }],
    )
    expect(jours).toHaveLength(1)
    expect(jours[0]).toMatchObject({ jour: '2026-09-20', sessions: 110, achats: 3, revenuCents: 23_050 })
    expect(jours[0]!.canaux.ia).toMatchObject({ sessions: 10, origines: { 'chatgpt.com / referral': 10 } })
    expect(jours[0]!.appareils).toEqual({ mobile: { sessions: 100, achats: 2 }, desktop: { sessions: 10, achats: 1 } })
    expect(jours[0]!.pagesSeo[0]).toEqual({ page: '/bougie-citrine', sessions: 30, achats: 2, revenuCents: 15_050 })
    expect(dateGa4('2026-09-20')).toBeNull()
  })
})

describe('Nova V3 — propriété du site', () => {
  it('prend la propriété dont le nom rappelle le site, sinon la première', () => {
    const proprietes = [
      { id: 'properties/1', nom: 'Ancien blog', compte: 'A' },
      { id: 'properties/2', nom: 'Cap-Nature boutique', compte: 'B' },
    ]
    expect(proprieteDuSite(proprietes, 'www.cap-nature.ch')?.id).toBe('properties/2')
    expect(proprieteDuSite(proprietes, 'autre.ch')?.id).toBe('properties/1')
    expect(proprieteDuSite([], 'x.ch')).toBeNull()
  })
})

const VENTES: CumulVentes = {
  commandes: 40,
  chiffre: 4_000,
  nouveauxClients: 20,
  chiffreNouveaux: 2_000,
  clientsIdentifies: 40,
  canaux: {},
  canauxPremier: {},
  produits: [],
}

function donnees(visites: Donnees['visites']): Donnees {
  return {
    devise: 'CHF',
    regies: [],
    campagnes: [],
    ventes: { disponibles: true, couvertureDepuis: '2026-01-01', jours: [] },
    recherche: null,
    visites,
  }
}

function jour(jourIso: string, sessions: number, mobile: [number, number], desktop: [number, number]) {
  return {
    jour: jourIso,
    sessions,
    sessionsEngagees: sessions / 2,
    achats: mobile[1] + desktop[1],
    revenu: 0,
    canaux: {},
    appareils: { mobile: { sessions: mobile[0], achats: mobile[1] }, desktop: { sessions: desktop[0], achats: desktop[1] } },
    pages: [],
    pagesSeo: [],
  }
}

describe('Nova V3 — conversion et appareils', () => {
  it('rapporte les commandes de la boutique aux visites de GA4', () => {
    const visites = cumulVisites({ disponibles: true, couvertureDepuis: '2026-09-01', jours: [jour('2026-09-20', 2_000, [1_400, 10], [600, 12])] }, { du: '2026-09-20', au: '2026-09-20' })
    expect(tauxConversion(VENTES, visites)).toBe(2)
    expect(tauxConversion(null, visites)).toBe(1.1)
    expect(tauxConversion(VENTES, null)).toBeNull()
    expect(cumulVisites({ disponibles: true, couvertureDepuis: '2026-09-25', jours: [] }, { du: '2026-09-20', au: '2026-09-20' })).toBeNull()
  })

  it('signale un mobile qui convertit mal, et le confie à Cleo', () => {
    const periode = periodeDe('7', '2026-09-23')
    const d = donnees({ disponibles: true, couvertureDepuis: '2026-01-01', jours: [jour('2026-09-20', 2_000, [1_400, 7], [600, 12])] })
    const visites = cumulVisites(d.visites, periode)
    const ctx: Contexte = {
      donnees: d,
      bornes: periode,
      avant: { du: '2026-09-09', au: '2026-09-15' },
      reference: { du: '2026-08-17', au: '2026-09-15' },
      jours: 7,
      ventes: VENTES,
      ventesAvant: null,
      visites,
      visitesAvant: null,
      attribution: { plateformes: [], reel: null, revendique: 0, chevauchement: false, explication: '', modele: '' },
      campagnes: [],
      produits: [],
    }
    const insight = detecterInsights(ctx).find((un) => un.cle === 'conversion.mobile')
    expect(insight?.texte).toBe('Votre taux de conversion mobile (0,5 %) est inférieur à celui sur ordinateur (2 %).')
    expect(detecterOpportunites(ctx, 'fr', 's1').find((un) => un.cle === 'cleo.mobile')).toMatchObject({ agent: 'cro', impact: 'eleve' })
  })

  it('alerte sur une conversion qui décroche à trafic comparable', () => {
    const periode = periodeDe('7', '2026-09-23')
    const d = donnees({
      disponibles: true,
      couvertureDepuis: '2026-01-01',
      jours: [jour('2026-09-12', 1_000, [500, 15], [500, 15]), jour('2026-09-20', 1_000, [500, 5], [500, 5])],
    })
    const ctx: Contexte = {
      donnees: d,
      bornes: periode,
      avant: { du: '2026-09-09', au: '2026-09-15' },
      reference: { du: '2026-08-17', au: '2026-09-15' },
      jours: 7,
      ventes: null,
      ventesAvant: null,
      visites: cumulVisites(d.visites, periode),
      visitesAvant: cumulVisites(d.visites, { du: '2026-09-09', au: '2026-09-15' }),
      attribution: { plateformes: [], reel: null, revendique: 0, chevauchement: false, explication: '', modele: '' },
      campagnes: [],
      produits: [],
    }
    expect(detecterAlertes(ctx).find((un) => un.cle === 'conversion.baisse')).toMatchObject({ niveau: 'orange', agent: 'cro' })
  })
})

describe('Nova V3 — écarts inhabituels', () => {
  const veille = (jour: string, n: number) => new Date(Date.parse(jour) - n * 86_400_000).toISOString().slice(0, 10)

  it('compare un jour à la moyenne et à la variation des 28 précédents', async () => {
    const { ecartDuJour } = await import('@/server/nova/analyse')
    const serie = new Map<string, number>()
    for (let n = 1; n <= 28; n += 1) serie.set(veille('2026-09-22', n), n % 2 === 0 ? 10 : 12)
    serie.set('2026-09-22', 2)
    const ecart = ecartDuJour(serie, '2026-09-22', veille)!
    expect(ecart.moyenne).toBe(11)
    expect(ecart.ecartType).toBe(1)
    expect(ecart.z).toBe(-9)
    // Une série qui ne varie jamais ne dit rien d'un écart.
    expect(ecartDuJour(new Map([['2026-09-22', 5]]), '2026-09-22', veille)).toBeNull()
  })

  it('signale une journée de ventes effondrée, pas une petite boutique sans vente un jour', async () => {
    const { detecterEcarts } = await import('@/server/nova/analyse')
    const jours = Array.from({ length: 28 }, (_, i) => ({
      jour: veille('2026-09-22', i + 1),
      commandes: i % 2 === 0 ? 8 : 10,
      chiffre: 700,
      nouveauxClients: 0,
      chiffreNouveaux: 0,
      clientsIdentifies: 0,
      canaux: {},
      canauxPremier: {},
      produits: [],
    }))
    const ctx = (commandesDuJour: number, moyenneBasse = false) =>
      ({
        donnees: {
          devise: 'CHF',
          regies: [],
          campagnes: [],
          recherche: null,
          ventes: {
            disponibles: true,
            couvertureDepuis: '2026-01-01',
            jours: [
              ...jours.map((un) => (moyenneBasse ? { ...un, commandes: un.commandes % 2 } : un)),
              { ...jours[0]!, jour: '2026-09-22', commandes: commandesDuJour, chiffre: 700 },
            ],
          },
        },
        bornes: { du: '2026-09-16', au: '2026-09-22' },
        jours: 7,
      }) as unknown as Contexte
    const alerte = detecterEcarts(ctx(0)).find((un) => un.cle === 'ecart.commandes')
    expect(alerte?.texte).toBe('Le 22 septembre, le nombre de commandes a été inhabituellement bas.')
    expect(alerte?.niveau).toBe('orange')
    expect(detecterEcarts(ctx(0, true)).find((un) => un.cle === 'ecart.commandes')).toBeUndefined()
  })
})

describe('Nova V3 — transmission aux spécialistes', () => {
  it('écrit la question côté serveur, avec la mesure et sans conclure à une cause', async () => {
    const { questionNova } = await import('@/server/nova/delegation')
    const question = questionNova(
      { titre: 'L’expérience mobile coûte des ventes', pourquoi: 'Sur mobile, 0,5 % des visites achètent, contre 2 % sur ordinateur.' },
      'cro',
    )
    expect(question).toContain('Nova vous transmet une mesure : « L’expérience mobile coûte des ventes »')
    expect(question).toContain('retenir les visiteurs d’acheter')
    expect(question).toContain('pas une cause prouvée')
    expect(question.length).toBeLessThanOrEqual(600)
  })
})

describe('Nova V3 — libellé de la connexion GA4', () => {
  it('ne répète pas un nom porté par deux propriétés, et dit combien il y en a', () => {
    const p = (id: string, nom: string) => ({ id: `properties/${id}`, nom, compte: 'Cap Nature' })
    expect(libelleProprietes([p('1', 'cap-nature.ch'), p('2', 'cap-nature.ch')])).toBe('cap-nature.ch (2 propriétés)')
    expect(libelleProprietes([p('1', 'cap-nature.ch')])).toBe('cap-nature.ch')
    expect(libelleProprietes([p('1', 'cap-nature.ch'), p('2', 'boutique.ch')])).toBe('cap-nature.ch, boutique.ch')
  })
})
