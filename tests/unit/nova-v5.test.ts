import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculerAbonnements, indicateursAbonnements, type InstantaneAbonnements } from '@/server/nova/abonnements'
import { convertirAbonnement, mensuel, verifyStripeLecture, type Abonnement } from '@/server/integrations/providers/stripe-lecture'
import { convertirCommandeWoo, normaliserBoutiqueWoo, verifyWooKey, visiteWoo } from '@/server/integrations/providers/woocommerce'
import { canalDeVisite } from '@/server/nova/canaux'

const abo = (debut: string, fin: string | null, mensuelCents: number | null = 5_000, partiel: Partial<Abonnement> = {}): Abonnement => ({
  debut,
  fin,
  mensuelCents,
  devise: 'CHF',
  essai: false,
  ...partiel,
})

describe('Nova V5 — prix Stripe ramené au mois', () => {
  it('convertit jour, semaine, mois et année, et refuse ce qui ne se chiffre pas', () => {
    expect(mensuel({ unit_amount: 12_000, recurring: { interval: 'year', interval_count: 1 } }, 1)).toBe(1_000)
    expect(mensuel({ unit_amount: 3_000, recurring: { interval: 'month', interval_count: 3 } }, 2)).toBe(2_000)
    expect(mensuel({ unit_amount: 1_000, recurring: { interval: 'week', interval_count: 1 } }, 1)).toBe(4_333)
    expect(mensuel({ unit_amount: null, recurring: { interval: 'month' } }, 1)).toBeNull()
    expect(mensuel({ unit_amount: 1_000, recurring: null }, 1)).toBeNull()
  })

  it('ne compte ni un paiement initial avorté, ni un abonnement arrêté pendant l’essai', () => {
    const maintenant = new Date('2026-09-23T12:00:00Z')
    const base = { currency: 'chf', items: { data: [{ quantity: 1, price: { unit_amount: 5_000, recurring: { interval: 'month' } } }] } }
    expect(convertirAbonnement({ ...base, status: 'incomplete_expired', start_date: 1_700_000_000 }, maintenant)).toBeNull()
    expect(convertirAbonnement({ ...base, status: 'canceled', start_date: 1_700_000_000, trial_end: 1_701_000_000, ended_at: 1_700_500_000 }, maintenant)).toBeNull()
    const enEssai = convertirAbonnement({ ...base, status: 'trialing', start_date: 1_790_000_000, trial_end: 1_791_000_000 }, maintenant)
    expect(enEssai).toMatchObject({ essai: true, mensuelCents: 5_000, devise: 'CHF' })
  })
})

describe('Nova V5 — MRR, série et cohortes', () => {
  it('compte le MRR courant sans les essais, et la série mois par mois', () => {
    const instantane = calculerAbonnements(
      [
        abo('2026-01-10', null),
        abo('2026-03-05', '2026-07-20'),
        abo('2026-09-02', null, 10_000),
        abo('2026-09-15', null, 5_000, { essai: true }),
        abo('2026-05-01', null, null),
      ],
      '2026-09-23',
    )
    // 50 + 100 ; le prix variable compte comme abonné mais pas dans le MRR ; l'essai nulle part.
    expect(instantane).toMatchObject({ mrr: 150, actifs: 3, essais: 1, nonChiffres: 1, devise: 'CHF' })
    expect(instantane.serie).toHaveLength(13)
    expect(instantane.serie.find((m) => m.mois === '2026-07')).toMatchObject({ perdus: 1, mrrPerdu: 50 })
    expect(instantane.serie.at(-1)).toMatchObject({ mois: '2026-09', nouveaux: 1, mrrNouveau: 100 })
  })

  it('écarte une autre devise au lieu de l’additionner', () => {
    const instantane = calculerAbonnements([abo('2026-01-10', null), abo('2026-01-10', null), abo('2026-02-10', null, 9_000, { devise: 'EUR' })], '2026-09-23')
    expect(instantane).toMatchObject({ devise: 'CHF', mrr: 100, autresDevises: 1 })
  })

  it('suit une cohorte dans le temps', () => {
    const cohorte = [abo('2026-06-03', null), abo('2026-06-10', '2026-07-15'), abo('2026-06-20', '2026-08-30'), abo('2026-06-25', null)]
    const instantane = calculerAbonnements(cohorte, '2026-09-23')
    expect(instantane.cohortes).toEqual([{ mois: '2026-06', depart: 4, restants: [1, 0.75, 0.5, 0.5] }])
  })

  it('ne donne ni churn ni LTV sur trop peu d’abonnés, et les calcule sinon', () => {
    const petit = indicateursAbonnements(calculerAbonnements([abo('2026-01-10', null)], '2026-09-23'))
    expect(petit).toMatchObject({ churn: null, ltv: null })
    expect(petit.raisonLtv).toContain('20 abonnés')

    // 40 abonnés depuis janvier ; 2 partent en juin, juillet et août : churn ≈ 5 %.
    const liste: Abonnement[] = Array.from({ length: 40 }, (_, i) => abo('2026-01-05', i < 2 ? '2026-06-10' : i < 4 ? '2026-07-10' : i < 6 ? '2026-08-10' : null))
    const indicateurs = indicateursAbonnements(calculerAbonnements(liste, '2026-09-23'))
    expect(indicateurs.actifs).toBe(34)
    expect(indicateurs.churn).toBeCloseTo(6 / (40 + 38 + 36), 5)
    expect(indicateurs.arpu).toBe(50)
    expect(indicateurs.ltv).toBeCloseTo(50 / (6 / 114), 0)
    expect(indicateurs.arr).toBe(34 * 50 * 12)
  })

  it('refuse une LTV infinie quand personne ne part', () => {
    const liste: Abonnement[] = Array.from({ length: 30 }, () => abo('2026-01-05', null))
    const indicateurs = indicateursAbonnements(calculerAbonnements(liste, '2026-09-23') as InstantaneAbonnements)
    expect(indicateurs).toMatchObject({ churn: 0, ltv: null })
    expect(indicateurs.raisonLtv).toContain('infinie')
  })
})

describe('Nova V5 — clés Stripe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuse une clé secrète complète et une clé publiable, sans rien appeler', async () => {
    const appel = vi.fn()
    vi.stubGlobal('fetch', appel)
    expect(await verifyStripeLecture('sk_live_' + 'a'.repeat(30))).toMatchObject({ ok: false, reason: expect.stringContaining('clé restreinte') })
    expect(await verifyStripeLecture('pk_live_' + 'a'.repeat(30))).toMatchObject({ ok: false })
    expect(appel).not.toHaveBeenCalled()
  })

  it('accepte une clé restreinte qui lit abonnements et paiements, et nomme le droit qui manque sinon', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => new Response(JSON.stringify({ data: [] }), { status: String(url).includes('charges') ? 403 : 200 })))
    const refus = await verifyStripeLecture('rk_live_' + 'a'.repeat(30))
    expect(refus).toMatchObject({ ok: false, reason: expect.stringContaining('Charges') })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
    expect(await verifyStripeLecture('rk_test_' + 'a'.repeat(30))).toMatchObject({ ok: true, label: 'Stripe · mode test' })
  })
})

describe('Nova V5 — WooCommerce', () => {
  it('ramène l’adresse à https, sans le chemin de l’API', () => {
    expect(normaliserBoutiqueWoo('ma-boutique.ch/')).toBe('https://ma-boutique.ch')
    expect(normaliserBoutiqueWoo('http://ma-boutique.ch/shop/wp-json/wc/v3')).toBe('https://ma-boutique.ch/shop')
    expect(() => normaliserBoutiqueWoo('localhost')).toThrow()
  })

  it('refuse des clés qui n’ont pas la forme de WooCommerce avant tout appel', async () => {
    expect(await verifyWooKey('mauvais', { boutique: 'ma-boutique.ch', cle: 'ck_' + 'a'.repeat(40) })).toMatchObject({ ok: false })
    expect(await verifyWooKey('cs_' + 'a'.repeat(40), { boutique: 'ma-boutique.ch', cle: 'pas-une-cle' })).toMatchObject({ ok: false })
  })

  it('déduit les remboursements, écarte les commandes non payées, et ne garde aucun client', () => {
    const commande = convertirCommandeWoo({
      id: 12,
      status: 'completed',
      currency: 'CHF',
      date_created_gmt: '2026-09-20T10:00:00',
      total: '120.00',
      customer_id: 7,
      refunds: [{ total: '-20.00' }],
      line_items: [{ product_id: 3, variation_id: 0, name: 'Bougie', quantity: 2, total: '110.00' }],
      meta_data: [
        { key: '_wc_order_attribution_source_type', value: 'utm' },
        { key: '_wc_order_attribution_utm_source', value: 'facebook' },
        { key: '_wc_order_attribution_utm_medium', value: 'paid' },
        { key: '_billing_email', value: 'ne-doit-pas-sortir@exemple.test' },
      ],
    })
    expect(commande).toMatchObject({ totalCents: 10_000, annulee: false, creeLe: '2026-09-20T10:00:00Z', premiere: null })
    expect(canalDeVisite(commande.visite).canal).toBe('meta-ads')
    expect(JSON.stringify(commande)).not.toContain('exemple.test')
    expect(convertirCommandeWoo({ id: 1, status: 'pending', currency: 'CHF', date_created_gmt: null, total: '10', customer_id: 0 }).annulee).toBe(true)
  })

  it('lit l’origine d’une visite tapée à la main comme directe, et sans attribution comme inconnue', () => {
    expect(canalDeVisite(visiteWoo([{ key: '_wc_order_attribution_source_type', value: 'typein' }])).canal).toBe('direct')
    expect(visiteWoo([])).toBeNull()
    const seo = visiteWoo([
      { key: '_wc_order_attribution_source_type', value: 'organic' },
      { key: '_wc_order_attribution_utm_source', value: 'google' },
      { key: '_wc_order_attribution_utm_medium', value: 'organic' },
    ])
    expect(canalDeVisite(seo).canal).toBe('seo')
  })
})
