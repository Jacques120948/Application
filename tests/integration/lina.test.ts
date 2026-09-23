import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as clientsShopify from '@/server/integrations/providers/shopify-clients'
import * as visibilite from '@/server/agents/visibility-service'
import { synchroniserLina } from '@/server/lina/collecte'
import { enregistrerCriteres } from '@/server/lina/criteres'
import { deleguerLina } from '@/server/lina/delegation'
import { lireLina, lireMembres } from '@/server/lina/service'
import { depuisLina } from '@/server/oria/signaux'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Lina de bout en bout, sur une vraie base, sans appeler Shopify.
 *
 * Ce qui est éprouvé : l'export est lancé puis suivi, l'index est écrit sans rien qui dise
 * qui est un client, les segments suivent les réglages, Milo reçoit des totaux et pas des
 * personnes, et chacun ne voit que sa propre base.
 */

vi.mock('@/server/integrations/providers/shopify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify')>()),
  frapperJeton: vi.fn(async () => ({ ok: true, jeton: 'jeton-test' })),
  lirePortees: vi.fn(async () => ['read_orders', 'read_customers']),
}))
vi.mock('@/server/integrations/providers/shopify-clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify-clients')>()),
  lancerExportClients: vi.fn(),
  suivreExport: vi.fn(),
  telechargerExport: vi.fn(),
  lirePaniersAbandonnes: vi.fn(),
}))
vi.mock('@/server/agents/visibility-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/agents/visibility-service')>()),
  askVisibility: vi.fn(async () => ({ agent: 'content', agentName: 'Milo', answer: 'Trois emails.', creditsSpent: 3 })),
}))

const JOUR = 24 * 60 * 60 * 1000
let boutique: string
let voisin: string

const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString()

function client(ref: number, commandes: number, caCents: number, joursDepuis: number | null, consentement: clientsShopify.ConsentementClient = 'oui'): clientsShopify.ClientShopify {
  return { ref: String(ref), creeLe: ilYA(600), derniereCommande: joursDepuis === null ? null : ilYA(joursDepuis), commandes, caCents, devise: 'CHF', consentement }
}

const BASE: clientsShopify.ClientShopify[] = [
  ...Array.from({ length: 40 }, (_, i) => client(1_000 + i, 1, 6_000, 20)),
  ...Array.from({ length: 30 }, (_, i) => client(2_000 + i, 4, 30_000, 25)),
  ...Array.from({ length: 24 }, (_, i) => client(3_000 + i, 2, 12_000, 130, i % 3 === 0 ? 'non' : 'oui')),
  ...Array.from({ length: 26 }, (_, i) => client(4_000 + i, 2, 16_000, 400)),
  ...Array.from({ length: 5 }, (_, i) => client(5_000 + i, 0, 0, null, 'sans-email')),
]

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  boutique = await creer()
  voisin = await creer()
  await storeConnection(boutique, findProvider('shopify')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'lina-test.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
    accountLabel: 'lina-test.myshopify.com',
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [boutique, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Lina — collecte', () => {
  it('lance l’export avec le consentement, et lit les paniers en totaux', async () => {
    vi.mocked(clientsShopify.lirePaniersAbandonnes).mockResolvedValueOnce({
      ok: true,
      tronque: false,
      paniers: Array.from({ length: 15 }, (_, i) => ({ creeLe: ilYA(3), recupere: i < 3, totalCents: 8_000, devise: 'CHF' })),
    })
    vi.mocked(clientsShopify.lancerExportClients).mockResolvedValueOnce({ ok: true, operation: 'gid://shopify/BulkOperation/1' })
    const etat = await synchroniserLina(boutique, 'manuel')
    expect(etat).toMatchObject({ etat: 'en-cours', boutique: 'lina-test.myshopify.com' })
    expect(clientsShopify.lancerExportClients).toHaveBeenCalledWith(expect.anything(), 'jeton-test', true)
    expect(etat.paniers?.courant).toMatchObject({ nombre: 15, recuperes: 3 })
  })

  it('attend Shopify sans rien relancer, puis écrit l’index quand l’export est prêt', async () => {
    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'en-cours', url: null, lus: 40, raison: '' })
    expect((await synchroniserLina(boutique, 'suivre')).etat).toBe('en-cours')

    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'termine', url: 'https://storage.example/export.jsonl', lus: 125, raison: '' })
    vi.mocked(clientsShopify.telechargerExport).mockResolvedValueOnce({ clients: BASE, tronque: false })
    const etat = await synchroniserLina(boutique, 'suivre')
    expect(etat).toMatchObject({ etat: 'ok', clients: 125, consentement: true })
    expect(clientsShopify.lancerExportClients).toHaveBeenCalledTimes(1)

    const lignes = await withUserScope(boutique, (tx) => tx.linaClient.findMany({ where: { userId: boutique } }))
    expect(lignes).toHaveLength(125)
    // Rien qui dise qui est un client : ni nom, ni courriel, ni jeton.
    expect(Object.keys(lignes[0]!).sort()).toEqual(['caCents', 'commandes', 'consentement', 'creeLe', 'derniereCommande', 'devise', 'id', 'ref', 'source', 'userId'])
    const synchro = await withUserScope(boutique, (tx) => tx.linaSynchro.findFirstOrThrow({ where: { userId: boutique } }))
    expect(JSON.stringify(synchro)).not.toMatch(/jeton-test|secret-de-test/u)
  })

  it('ne relit pas une base fraîche à l’ouverture', async () => {
    vi.mocked(clientsShopify.lancerExportClients).mockClear()
    await synchroniserLina(boutique, 'auto')
    expect(clientsShopify.lancerExportClients).not.toHaveBeenCalled()
  })

  it('relance sans consentement quand Shopify le refuse', async () => {
    const autre = await creer()
    await storeConnection(autre, findProvider('shopify')!, {
      kind: 'API_KEY',
      secret: JSON.stringify({ boutique: 'autre.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
      accountLabel: 'autre.myshopify.com',
    })
    vi.mocked(clientsShopify.lirePaniersAbandonnes).mockResolvedValueOnce({ ok: false, raison: 'Paniers refusés.' })
    vi.mocked(clientsShopify.lancerExportClients)
      .mockResolvedValueOnce({ ok: false, protegees: true, raison: 'protégées' })
      .mockResolvedValueOnce({ ok: false, protegees: true, raison: 'protégées' })
    const etat = await synchroniserLina(autre, 'manuel')
    expect(clientsShopify.lancerExportClients).toHaveBeenLastCalledWith(expect.anything(), 'jeton-test', false)
    expect(etat.etat).toBe('protegees')
    expect(etat.message).toContain('Protected customer data')
    expect(etat.paniers?.erreur).toBe('Paniers refusés.')
    await prisma.user.delete({ where: { id: autre } })
  })
})

describe('Lina — la vue', () => {
  it('segmente, recommande et transmet à Oria', async () => {
    const vue = await lireLina(boutique, { avecNova: false })
    expect(vue.vierge).toBe(false)
    expect(vue.indicateurs).toMatchObject({ acheteurs: 120, recurrents: 80, dormants: 26, aReactiver: 24 })
    expect(vue.segments.find((segment) => segment.cle === 'a-reactiver')).toMatchObject({ nombre: 24, contactables: 16 })
    expect(vue.campagnes.map((campagne) => campagne.cle)).toEqual(expect.arrayContaining(['panier-abandonne', 'reactivation', 'win-back']))
    expect(vue.insights.length).toBeGreaterThan(0)
    expect(vue.insights.length).toBeLessThanOrEqual(5)
    const signaux = depuisLina(vue, 'fr', '')
    expect(signaux.length).toBeGreaterThan(0)
    expect(signaux.every((signal) => signal.sources.includes('lina') && signal.urgence === 'information')).toBe(true)
  })

  it('suit les réglages sans relire la boutique', async () => {
    await enregistrerCriteres(boutique, { actifJours: 60, dormantJours: 120, nouveauJours: 30, fideleCommandes: 3, vipPart: 0.05 })
    const vue = await lireLina(boutique, { avecNova: false })
    expect(vue.indicateurs?.dormants).toBe(50)
  })

  it('liste les clients d’un segment par un numéro, les plus gros d’abord', async () => {
    const membres = await lireMembres(boutique, 'recurrents', 10)
    expect(membres).toHaveLength(10)
    expect(membres[0]!.caCents).toBe(30_000)
    expect(Object.keys(membres[0]!).sort()).toEqual(['caCents', 'commandes', 'consentement', 'derniereCommande', 'ref'])
  })

  it('confie la campagne à Milo avec des totaux, jamais un client', async () => {
    const siteId = randomUUID()
    await deleguerLina(boutique, { siteId, cle: 'win-back', agent: 'content' }, 'fr')
    const appel = vi.mocked(visibilite.askVisibility).mock.calls.at(-1)!
    expect(appel[1]).toMatchObject({ siteId, agent: 'content' })
    expect(appel[1].question).toContain('Lina vous confie une campagne')
    expect(appel[1].question).not.toMatch(/\b4\d{3}\b|lina-test/u)
    expect(appel[3]).toEqual({ demandePar: 'lina' })
  })

  it('transmet les paniers perdus à Cleo, et rien d’autre', async () => {
    await deleguerLina(boutique, { siteId: randomUUID(), cle: 'paniers', agent: 'cro' }, 'fr')
    expect(vi.mocked(visibilite.askVisibility).mock.calls.at(-1)![1].question).toContain('15 paniers abandonnés')
    await expect(deleguerLina(boutique, { siteId: randomUUID(), cle: 'inconnue', agent: 'content' }, 'fr')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('ne montre à personne la base d’un autre', async () => {
    expect(await withUserScope(voisin, (tx) => tx.linaClient.count())).toBe(0)
    expect(await withUserScope(voisin, (tx) => tx.linaSynchro.count())).toBe(0)
    const vue = await lireLina(voisin, { avecNova: false })
    expect(vue.vierge).toBe(true)
    expect(vue.etat.etat).toBe('absent')
  })
})
