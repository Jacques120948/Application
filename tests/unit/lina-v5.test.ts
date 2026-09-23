import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireLigneClient } from '@/server/integrations/providers/shopify-clients'
import { lireAffairesClients, lirePortailHubspot } from '@/server/integrations/providers/hubspot'
import { lienFiche } from '@/lib/lina'
import { redire } from '@/server/lina/sources'
import { indicateurs, segmenter, contexteSegments, type ClientIndex } from '@/server/lina/segments'
import { CRITERES_DEFAUT } from '@/server/lina/criteres'

/**
 * Lina V5 : le consentement SMS lu dans l'export Shopify (jamais le numéro), HubSpot comme
 * source de clients (affaires gagnées → contact associé), et les textes qui suivent.
 */

afterEach(() => vi.unstubAllGlobals())

describe('consentement SMS', () => {
  const ligne = (telephone: unknown) =>
    JSON.stringify({
      id: 'gid://shopify/Customer/7',
      createdAt: '2025-01-01T00:00:00Z',
      numberOfOrders: '2',
      amountSpent: { amount: '80.00', currencyCode: 'CHF' },
      lastOrder: { createdAt: '2026-09-01T00:00:00Z' },
      defaultEmailAddress: { marketingState: 'SUBSCRIBED' },
      defaultPhoneNumber: telephone,
    })

  it('lit l’état, jamais le numéro', () => {
    expect(lireLigneClient(ligne({ marketingState: 'SUBSCRIBED' }), true, true)?.consentementSms).toBe('oui')
    expect(lireLigneClient(ligne({ marketingState: 'UNSUBSCRIBED' }), true, true)?.consentementSms).toBe('non')
    expect(lireLigneClient(ligne(null), true, true)?.consentementSms).toBe('sans-telephone')
    expect(lireLigneClient(ligne({ marketingState: 'SUBSCRIBED' }), true, false)?.consentementSms).toBe('inconnu')
    expect(JSON.stringify(lireLigneClient(ligne({ marketingState: 'SUBSCRIBED', phoneNumber: '+41790000000' }), true, true))).not.toContain('+41')
  })

  it('compte les joignables par SMS, seulement quand c’est lu', () => {
    const maintenant = new Date('2026-09-23T00:00:00Z')
    const clients: ClientIndex[] = Array.from({ length: 30 }, (_, i) => ({
      ref: String(i),
      creeLe: new Date('2025-01-01'),
      derniereCommande: new Date('2026-09-01'),
      commandes: 2,
      caCents: 10_000,
      consentement: 'oui',
      consentementSms: i < 12 ? 'oui' : 'non',
    }))
    const contexte = contexteSegments(clients, CRITERES_DEFAUT, maintenant)
    const avec = segmenter(clients, contexte, true, 'CHF', true)
    expect(avec.find((un) => un.cle === 'recurrents')?.contactablesSms).toBe(12)
    expect(indicateurs(clients, avec, true, true).contactablesSms).toBe(12)
    const sans = segmenter(clients, contexte, true, 'CHF')
    expect(sans.find((un) => un.cle === 'recurrents')?.contactablesSms).toBeNull()
  })
})

describe('HubSpot pour Lina', () => {
  it('rattache chaque affaire gagnée à son contact, sans rien lire d’autre', async () => {
    const appel = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('deals/search')) {
        return Response.json({
          results: [
            { id: '11', properties: { amount: '1500', closedate: '2026-06-01T00:00:00Z', deal_currency_code: 'chf' } },
            { id: '12', properties: { amount: '900.5', closedate: '2026-02-01T00:00:00Z', deal_currency_code: 'CHF' } },
            { id: '13', properties: { amount: '', closedate: '2025-11-01T00:00:00Z' } },
          ],
        })
      }
      if (url.includes('associations/deals/contacts/batch/read')) {
        expect(JSON.parse(String(init?.body))).toEqual({ inputs: [{ id: '11' }, { id: '12' }, { id: '13' }] })
        return Response.json({ results: [{ from: { id: '11' }, to: [{ toObjectId: 501 }, { toObjectId: 502 }] }, { from: { id: '12' }, to: [{ toObjectId: 501 }] }] })
      }
      return Response.json({ portalId: 4242 })
    })
    vi.stubGlobal('fetch', appel)
    const lecture = await lireAffairesClients('jeton', '2023-09-23', { max: 1_000, echeance: Date.now() + 10_000 })
    expect(lecture).toEqual({
      ok: true,
      tronque: false,
      sansClient: 1,
      commandes: [
        { id: 'hubspot:11', creeLe: '2026-06-01T00:00:00.000Z', clientRef: '501', totalCents: 150_000, devise: 'CHF', lignes: [] },
        { id: 'hubspot:12', creeLe: '2026-02-01T00:00:00.000Z', clientRef: '501', totalCents: 90_050, devise: 'CHF', lignes: [] },
        { id: 'hubspot:13', creeLe: '2025-11-01T00:00:00.000Z', clientRef: null, totalCents: 0, devise: '', lignes: [] },
      ],
    })
    const recherche = JSON.parse(String((appel.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { properties: string[] }
    expect(recherche.properties).toEqual(['amount', 'closedate', 'deal_currency_code'])
    expect(await lirePortailHubspot('jeton')).toBe('4242')
  })

  it('ouvre la fiche du contact dans HubSpot et parle du CRM', () => {
    expect(lienFiche('hubspot', '4242', '501')?.href).toBe('https://app.hubspot.com/contacts/4242/record/0-1/501')
    expect(lienFiche('hubspot', '', '501')).toBeNull()
    expect(redire('Vérifiez dans Shopify qu’ils acceptent vos emails.', 'hubspot')).toBe('Vérifiez dans votre outil d’envoi qu’ils acceptent vos emails.')
  })
})
