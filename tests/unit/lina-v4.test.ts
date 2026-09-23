import { afterEach, describe, expect, it, vi } from 'vitest'
import * as net from '@/server/audit/net'
import { lireCommandesClientsWoo } from '@/server/integrations/providers/woocommerce'
import { lireEncaissementsClients } from '@/server/integrations/providers/stripe-lecture'
import { creerSegmentShopify } from '@/server/integrations/providers/shopify-clients'
import { indexDepuisCommandes, pseudonyme } from '@/server/lina/collecte-autres'
import { lienFiche, numeroClient, redire } from '@/server/lina/sources'
import { lienSegment } from '@/server/lina/assiste'
import { OBJECTIFS_VIDES, progression } from '@/server/lina/objectifs'

/**
 * Lina V4 : WooCommerce et Stripe comme sources de clients (courriels jamais gardés), textes
 * redits pour la source, liens vers les fiches, création de segment Shopify, objectif de
 * valeur client. Les appels extérieurs sont simulés.
 */

vi.mock('@/server/audit/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/audit/net')>()),
  requeteJson: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(net.requeteJson).mockReset()
})

const commande = (id: string, client: string | null, jour: string, total: number) => ({ id, creeLe: `${jour}T10:00:00Z`, clientRef: client, totalCents: total, devise: 'CHF', lignes: [] })

describe('index reconstruit à partir des commandes', () => {
  it('une ligne par client, sans les commandes anonymes', () => {
    const index = indexDepuisCommandes([
      commande('1', 'c7', '2026-03-01', 5_000),
      commande('2', 'c7', '2026-09-01', 7_000),
      commande('3', null, '2026-09-02', 2_000),
      commande('4', 'gABC', '2025-01-10', 3_000),
    ])
    expect(index).toHaveLength(2)
    expect(index.find((un) => un.ref === 'c7')).toMatchObject({ commandes: 2, caCents: 12_000, creeLe: '2026-03-01T10:00:00Z', derniereCommande: '2026-09-01T10:00:00Z' })
  })

  it('une empreinte stable, qui ne contient pas le courriel', () => {
    const a = pseudonyme('marie@exemple.ch')
    expect(a).toBe(pseudonyme('marie@exemple.ch'))
    expect(a).not.toBe(pseudonyme('paul@exemple.ch'))
    expect(a).not.toMatch(/marie|exemple/u)
    expect(a).toHaveLength(22)
  })
})

describe('WooCommerce pour Lina', () => {
  it('reconnaît les clients inscrits, pseudonymise les achats sans compte, écarte les annulations', async () => {
    vi.mocked(net.requeteJson).mockResolvedValueOnce({
      status: 200,
      entetes: { 'x-wp-totalpages': '1' },
      corps: [
        { id: 1, status: 'completed', currency: 'CHF', date_created_gmt: '2026-09-01T10:00:00', total: '50.00', customer_id: 12, billing: { email: 'x@y.ch' }, line_items: [{ product_id: 9, name: 'Bougie', quantity: 2, total: '50.00' }] },
        { id: 2, status: 'processing', currency: 'CHF', date_created_gmt: '2026-09-02T10:00:00', total: '30.00', customer_id: 0, billing: { email: ' Marie@Exemple.ch ' }, refunds: [{ total: '-10.00' }] },
        { id: 3, status: 'cancelled', currency: 'CHF', date_created_gmt: '2026-09-03T10:00:00', total: '99.00', customer_id: 12 },
        { id: 4, status: 'completed', currency: 'CHF', date_created_gmt: '2026-09-04T10:00:00', total: '20.00', customer_id: 0, billing: {} },
      ],
    })
    const lecture = await lireCommandesClientsWoo({ boutique: 'https://boutique.exemple.ch', cle: 'ck', secret: 'cs' }, '2023-09-01', {
      max: 1_000,
      echeance: Date.now() + 10_000,
      pseudonyme,
    })
    expect(lecture.ok).toBe(true)
    if (!lecture.ok) return
    expect(lecture.commandes.map((un) => un.clientRef)).toEqual(['c12', `g${pseudonyme('marie@exemple.ch')}`, null])
    expect(lecture.commandes[0]!.lignes).toEqual([{ produitRef: '9', titre: 'Bougie', type: '', quantite: 2, prixUnitaireCents: 2_500 }])
    expect(lecture.commandes[1]!.totalCents).toBe(2_000)
    expect(lecture.sansClient).toBe(1)
    expect(JSON.stringify(lecture)).not.toMatch(/@/u)
    // Le courriel est demandé, et seulement lui parmi les coordonnées.
    const url = vi.mocked(net.requeteJson).mock.calls[0]![0]
    expect(url.searchParams.get('_fields')).toContain('billing.email')
    expect(url.searchParams.get('_fields')).not.toMatch(/first_name|address|phone/u)
    expect(url.searchParams.get('order')).toBe('desc')
  })

  it('s’arrête à l’échéance et le dit', async () => {
    const lecture = await lireCommandesClientsWoo({ boutique: 'https://boutique.exemple.ch', cle: 'ck', secret: 'cs' }, '2023-09-01', {
      max: 1_000,
      echeance: Date.now() - 1,
      pseudonyme,
    })
    expect(lecture).toMatchObject({ ok: true, tronque: true, commandes: [] })
    expect(net.requeteJson).not.toHaveBeenCalled()
  })
})

describe('Stripe pour Lina', () => {
  it('rattache les paiements réussis à leur client, compte les autres', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          has_more: false,
          data: [
            { id: 'ch_1', amount: 4_900, amount_refunded: 0, currency: 'chf', created: 1_788_000_000, status: 'succeeded', paid: true, customer: 'cus_A1' },
            { id: 'ch_2', amount: 4_900, amount_refunded: 4_900, currency: 'chf', created: 1_788_100_000, status: 'succeeded', paid: true, customer: 'cus_A1' },
            { id: 'ch_3', amount: 2_000, amount_refunded: 0, currency: 'chf', created: 1_788_200_000, status: 'failed', paid: false, customer: 'cus_B2' },
            { id: 'ch_4', amount: 1_500, amount_refunded: 0, currency: 'chf', created: 1_788_300_000, status: 'succeeded', paid: true, customer: null },
          ],
        }),
      ),
    )
    const lecture = await lireEncaissementsClients('rk_test_x', '2023-09-01', { max: 100, echeance: Date.now() + 10_000 })
    expect(lecture.ok && lecture.commandes.map((un) => [un.clientRef, un.totalCents])).toEqual([
      ['cus_A1', 4_900],
      [null, 1_500],
    ])
    expect(lecture.ok && lecture.sansClient).toBe(1)
  })
})

describe('textes et liens selon la source', () => {
  it('redit les consignes Shopify pour une autre source', () => {
    expect(redire('Vérifiez dans Shopify qu’ils acceptent vos emails.', 'woocommerce')).toBe('Vérifiez dans votre outil d’envoi qu’ils acceptent vos emails.')
    expect(redire('Shopify → Marketing → Automatisations → Post-achat', 'stripe')).toBe('Votre outil d’envoi → automatisation « Post-achat »')
    expect(redire('Shopify Flow (déclencheur planifié) ou segment Shopify', 'woocommerce')).toBe('une automatisation de votre outil d’envoi ou liste dans votre outil d’envoi')
    expect(redire('Vérifiez dans Shopify.', 'shopify')).toBe('Vérifiez dans Shopify.')
  })

  it('ouvre la fiche là où le nom se lit', () => {
    expect(lienFiche('shopify', 'demo.myshopify.com', '123')?.href).toBe('https://demo.myshopify.com/admin/customers/123')
    expect(lienFiche('woocommerce', 'https://boutique.ch', 'c42')?.href).toBe('https://boutique.ch/wp-admin/user-edit.php?user_id=42')
    expect(lienFiche('woocommerce', 'https://boutique.ch', 'gAbC')).toBeNull()
    expect(lienFiche('stripe', '', 'cus_Z9')?.href).toBe('https://dashboard.stripe.com/customers/cus_Z9')
    expect(numeroClient('woocommerce', 'gAbCdEfGh')).toBe('Achat sans compte AbCdEf…')
    expect(numeroClient('woocommerce', 'c42')).toBe('Client n° 42')
    expect(lienSegment('demo.myshopify.com', 'gid://shopify/Segment/77')).toBe('https://demo.myshopify.com/admin/customers/segments/77')
  })
})

describe('segment créé dans Shopify', () => {
  const acces = { boutique: 'demo.myshopify.com', version: '2026-07' } as never

  it('crée le segment et rend son identifiant', async () => {
    const appel = vi.fn(async () => Response.json({ data: { segmentCreate: { segment: { id: 'gid://shopify/Segment/5', name: 'x' }, userErrors: [] } } }))
    vi.stubGlobal('fetch', appel)
    expect(await creerSegmentShopify(acces, 'jeton', 'Lina — VIP', 'amount_spent >= 500')).toEqual({ ok: true, id: 'gid://shopify/Segment/5' })
    const corps = JSON.parse(String((appel.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { variables: Record<string, string> }
    expect(corps.variables).toEqual({ nom: 'Lina — VIP', q: 'amount_spent >= 500' })
  })

  it('dit quelle autorisation manque', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { segmentCreate: null }, errors: [{ message: 'Access denied for segmentCreate field. Required access: `write_customers` access scope.' }] })),
    )
    const resultat = await creerSegmentShopify(acces, 'jeton', 'Lina — VIP', 'amount_spent >= 500')
    expect(resultat).toMatchObject({ ok: false, portee: true })
    expect(!resultat.ok && resultat.raison).toContain('write_customers')
  })
})

describe('objectif de valeur client', () => {
  it('suit la dépense moyenne observée', () => {
    const [ligne] = progression({ ...OBJECTIFS_VIDES, valeurClient: 200 }, null, 'CHF', 15_000)
    expect(ligne).toMatchObject({ cle: 'valeurClient', cible: 'CHF 200', actuel: 'CHF 150', atteint: false })
    expect(ligne!.part).toBeCloseTo(0.75)
  })
})
