import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as clientsShopify from '@/server/integrations/providers/shopify-clients'
import * as hubspot from '@/server/integrations/providers/hubspot'
import * as visibilite from '@/server/agents/visibility-service'
import { synchroniserLina } from '@/server/lina/collecte'
import { deleguerLina } from '@/server/lina/delegation'
import { lireFicheClient, lireLina } from '@/server/lina/service'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Lina V5 sur une vraie base : le consentement SMS se demande d'abord et se replie sur
 * l'email quand Shopify refuse l'accès aux numéros ; HubSpot devient la base clients d'une
 * activité de services ; les comportements d'achat partent à Néo et Gia sans aucun client.
 */

vi.mock('@/server/integrations/providers/shopify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify')>()),
  frapperJeton: vi.fn(async () => ({ ok: true, jeton: 'jeton-test' })),
  lirePortees: vi.fn(async () => ['read_customers']),
  lireReglagesBoutique: vi.fn(async () => ({ fuseau: 'Europe/Zurich', devise: 'CHF' })),
}))
vi.mock('@/server/integrations/providers/shopify-clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify-clients')>()),
  lancerExportClients: vi.fn(async () => ({ ok: true, operation: 'gid://shopify/BulkOperation/5' })),
  suivreExport: vi.fn(),
  telechargerExport: vi.fn(),
}))
vi.mock('@/server/integrations/providers/hubspot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/hubspot')>()),
  lireAffairesClients: vi.fn(),
  lirePortailHubspot: vi.fn(async () => '4242'),
}))
vi.mock('@/server/agents/visibility-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/agents/visibility-service')>()),
  askVisibility: vi.fn(async () => ({ agent: 'geo', agentName: 'Gia', answer: 'Oui.', creditsSpent: 3 })),
}))

const JOUR = 24 * 60 * 60 * 1000
const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString()
let boutique: string
let cabinet: string
let editeur: string

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

const CLIENTS: clientsShopify.ClientShopify[] = Array.from({ length: 30 }, (_, i) => ({
  ref: String(50_000 + i),
  creeLe: ilYA(400),
  derniereCommande: ilYA(20),
  commandes: 2,
  caCents: 10_000,
  devise: 'CHF',
  consentement: 'oui',
  consentementSms: i < 9 ? 'oui' : 'sans-telephone',
}))

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  ;[boutique, cabinet, editeur] = await Promise.all([creer(), creer(), creer()])
  await storeConnection(boutique, findProvider('shopify')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'lina-v5.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
    accountLabel: 'lina-v5.myshopify.com',
  })
  // Un cabinet (services) et un éditeur de logiciel (SaaS), chacun avec HubSpot et Stripe.
  for (const [userId, activite] of [
    [cabinet, 'services'],
    [editeur, 'saas'],
  ] as const) {
    await storeConnection(userId, findProvider('hubspot')!, { kind: 'API_KEY', secret: ['pat', 'eu1', randomUUID()].join('-'), accountLabel: 'HubSpot · portail 4242' })
    await storeConnection(userId, findProvider('stripe-revenus')!, { kind: 'API_KEY', secret: ['rk', 'test', 'cle-de-test'].join('_'), accountLabel: 'Stripe · mode test' })
    await withUserScope(userId, (tx) => tx.novaReglages.create({ data: { userId, activite } }))
  }
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [boutique, cabinet, editeur] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Lina V5 — consentement SMS', () => {
  it('demande d’abord le SMS, et se replie sur l’email quand Shopify refuse les numéros', async () => {
    await synchroniserLina(boutique, 'manuel')
    expect(vi.mocked(clientsShopify.lancerExportClients).mock.calls.at(-1)!.slice(2)).toEqual([true, true])
    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'refuse', url: null, lus: 0, raison: 'refusé' })
    await synchroniserLina(boutique, 'suivre')
    expect(vi.mocked(clientsShopify.lancerExportClients).mock.calls.at(-1)!.slice(2)).toEqual([true, false])
    const ligne = await withUserScope(boutique, (tx) => tx.linaSynchro.findFirstOrThrow({ where: { userId: boutique } }))
    expect(ligne.smsRefuseAt).not.toBeNull()
    expect(ligne.operation?.endsWith('|c')).toBe(true)
    // L'export sans SMS aboutit : le consentement email est lu, le SMS reste inconnu.
    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'termine', url: 'https://stockage.example/clients.jsonl', lus: 30, raison: '' })
    vi.mocked(clientsShopify.telechargerExport).mockResolvedValueOnce({ clients: CLIENTS.map(({ consentementSms: _, ...client }) => client), tronque: false })
    const etat = await synchroniserLina(boutique, 'suivre')
    expect(etat).toMatchObject({ etat: 'ok', consentement: true, consentementSms: false })
  })

  it('compte les clients qui acceptent les SMS quand Shopify les donne', async () => {
    await withUserScope(boutique, (tx) => tx.linaSynchro.update({ where: { userId: boutique }, data: { operation: 'gid://shopify/BulkOperation/6|p' } }))
    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'termine', url: 'https://stockage.example/clients.jsonl', lus: 30, raison: '' })
    vi.mocked(clientsShopify.telechargerExport).mockResolvedValueOnce({ clients: CLIENTS, tronque: false })
    const etat = await synchroniserLina(boutique, 'suivre')
    expect(etat.consentementSms).toBe(true)
    expect(vi.mocked(clientsShopify.telechargerExport).mock.calls.at(-1)![3]).toBe(true)
    const vue = await lireLina(boutique, { avecNova: false })
    expect(vue.indicateurs?.contactablesSms).toBe(9)
    expect(vue.segments.find((un) => un.cle === 'recurrents')?.contactablesSms).toBe(9)
    expect((await lireFicheClient(boutique, '50000'))?.consentementSms).toBe('oui')
  })
})

describe('Lina V5 — HubSpot', () => {
  const affaires = Array.from({ length: 24 }, (_, i) => ({
    id: `hubspot:${i}`,
    creeLe: ilYA(i < 12 ? 30 + i : 300 + i),
    clientRef: String(700 + (i % 12)),
    totalCents: 250_000,
    devise: 'CHF',
    lignes: [] as [],
  }))

  it('fait des contacts qui ont signé la base clients d’une activité de services', async () => {
    vi.mocked(hubspot.lireAffairesClients).mockResolvedValueOnce({ ok: true, commandes: affaires, tronque: false, sansClient: 2 })
    const etat = await synchroniserLina(cabinet, 'manuel')
    expect(etat).toMatchObject({ etat: 'ok', source: 'hubspot', clients: 12, sansClient: 2, boutique: '4242' })
    const vue = await lireLina(cabinet, { avecNova: false })
    expect(vue.indicateurs?.recurrents).toBe(12)
    expect(vue.sante.some((un) => un.texte.includes('affaire gagnée'))).toBe(true)
    expect((await lireFicheClient(cabinet, '700'))?.lien?.href).toBe('https://app.hubspot.com/contacts/4242/record/0-1/700')
  })

  it('garde Stripe d’abord pour un SaaS', async () => {
    const etat = await synchroniserLina(editeur, 'suivre')
    expect(etat.source).toBe('stripe')
  })
})

describe('Lina V5 — Néo et Gia', () => {
  it('transmet les comportements d’achat, jamais un client', async () => {
    await withUserScope(boutique, async (tx) => {
      await tx.linaProduit.createMany({
        data: [
          { userId: boutique, ref: '1', titre: 'Bougie citrine', type: 'Bougies', acheteurs: 40, reacheteurs: 12, commandes: 60, caCents: 180_000, prixMoyenCents: 3_000, intervalleMedian: 45, intervalleP25: 30, intervalleP75: 60 },
          { userId: boutique, ref: '2', titre: 'Recharge', type: 'Accessoires', acheteurs: 20, reacheteurs: 0, commandes: 20, caCents: 30_000, prixMoyenCents: 1_500, intervalleMedian: null, intervalleP25: null, intervalleP75: null },
        ],
      })
      await tx.linaSynchro.update({
        where: { userId: boutique },
        data: {
          analyse: {
            au: new Date().toISOString(),
            depuis: '2023-09-01',
            commandes: 80,
            tronque: false,
            historiqueComplet: false,
            cohortes: [],
            suivants: [{ de: '1', vers: '2', clients: 16, part: 0.4 }],
            ensemble: [],
            montees: [],
            reachat: { medianeJours: null, p25Jours: null, p75Jours: null, sous: [], base: 0 },
          },
        },
      })
    })
    await deleguerLina(boutique, { siteId: randomUUID(), cle: 'comportements', agent: 'geo' }, 'fr')
    const appel = vi.mocked(visibilite.askVisibility).mock.calls.at(-1)!
    expect(appel[1].agent).toBe('geo')
    expect(appel[1].question).toContain('« Bougie citrine » est racheté en général entre 30 et 60 jours')
    expect(appel[1].question).toContain('40 % des acheteurs de « Bougie citrine » achètent ensuite « Recharge »')
    expect(appel[1].question).not.toMatch(/500\d\d/u)
    await expect(deleguerLina(boutique, { siteId: randomUUID(), cle: 'autre', agent: 'seo' }, 'fr')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
