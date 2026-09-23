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
import { deleguerLina } from '@/server/lina/delegation'
import { enregistrerResultat, lireResultats, supprimerResultat, testsAB } from '@/server/lina/resultats'
import { lireLina } from '@/server/lina/service'
import { faitsLina } from '@/server/lina/contexte'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Lina V2 sur une vraie base : la seconde phase (les commandes) enrichit l'index sans rien
 * garder des commandes elles-mêmes, ses pannes n'abîment pas l'index des clients, et les
 * résultats saisis ne se voient que chez leur auteur.
 */

vi.mock('@/server/integrations/providers/shopify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify')>()),
  frapperJeton: vi.fn(async () => ({ ok: true, jeton: 'jeton-test' })),
  lirePortees: vi.fn(async () => ['read_orders', 'read_all_orders', 'read_customers']),
  lireReglagesBoutique: vi.fn(async () => ({ fuseau: 'Europe/Zurich', devise: 'CHF' })),
}))
vi.mock('@/server/integrations/providers/shopify-clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify-clients')>()),
  lancerExportClients: vi.fn(async () => ({ ok: true, operation: 'gid://shopify/BulkOperation/1' })),
  lancerExportCommandes: vi.fn(async () => ({ ok: true, operation: 'gid://shopify/BulkOperation/2' })),
  telechargerCommandes: vi.fn(),
  suivreExport: vi.fn(),
  telechargerExport: vi.fn(),
  lirePaniersAbandonnes: vi.fn(async () => ({ ok: true, paniers: [], tronque: false })),
}))
vi.mock('@/server/agents/visibility-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/agents/visibility-service')>()),
  askVisibility: vi.fn(async () => ({ agent: 'meta', agentName: 'MIRA', answer: 'Oui.', creditsSpent: 3 })),
}))

const JOUR = 24 * 60 * 60 * 1000
const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString()
let boutique: string
let voisin: string

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

// 120 clients, chacun trois commandes : bougie, recharge 40 jours après, grande bougie 60 jours après.
const CLIENTS: clientsShopify.ClientShopify[] = Array.from({ length: 120 }, (_, i) => ({
  ref: String(10_000 + i),
  creeLe: ilYA(400),
  derniereCommande: ilYA(i < 60 ? 200 : 20),
  commandes: 3,
  caCents: 13_500,
  devise: 'CHF',
  consentement: 'oui',
}))
let numero = 0
const COMMANDES: clientsShopify.CommandeExport[] = CLIENTS.flatMap((client, i) => {
  const debut = i < 60 ? 300 : 120
  const ligne = (ref: string, titre: string, type: string, prix: number) => ({ produitRef: ref, titre, type, quantite: 1, prixUnitaireCents: prix })
  const commande = (jours: number, lignes: ReturnType<typeof ligne>[]) => ({
    id: `gid://shopify/Order/${(numero += 1)}`,
    creeLe: ilYA(jours),
    clientRef: client.ref,
    totalCents: lignes.reduce((total, un) => total + un.prixUnitaireCents, 0),
    devise: 'CHF',
    lignes,
  })
  return [
    commande(debut, [ligne('1', 'Bougie citrine', 'Bougies', 3_000)]),
    // Un client sur trois ne prend pas la recharge : c'est à eux que la campagne s'adresse.
    commande(debut - 40, [i % 3 === 0 ? ligne('1', 'Bougie citrine', 'Bougies', 3_000) : ligne('2', 'Recharge', 'Accessoires', 1_500)]),
    commande(debut - 100, [ligne('3', 'Grande bougie citrine', 'Bougies', 9_000)]),
  ]
})

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  boutique = await creer()
  voisin = await creer()
  await storeConnection(boutique, findProvider('shopify')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'lina-v2.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
    accountLabel: 'lina-v2.myshopify.com',
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [boutique, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Lina V2 — les commandes', () => {
  it('lit les clients, puis lance les commandes sur trois ans', async () => {
    expect((await synchroniserLina(boutique, 'manuel')).etat).toBe('en-cours')
    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'termine', url: 'https://stockage.example/clients.jsonl', lus: 120, raison: '' })
    vi.mocked(clientsShopify.telechargerExport).mockResolvedValueOnce({ clients: CLIENTS, tronque: false })
    const etat = await synchroniserLina(boutique, 'suivre')
    expect(etat).toMatchObject({ etat: 'ok', commandesEnCours: true })
    const depuis = vi.mocked(clientsShopify.lancerExportCommandes).mock.calls.at(-1)![2]
    expect(Date.now() - Date.parse(depuis)).toBeGreaterThan(1_000 * JOUR)
  })

  it('une panne des commandes laisse l’index des clients intact', async () => {
    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'echec', url: null, lus: 0, raison: 'Échec de test.' })
    const etat = await synchroniserLina(boutique, 'suivre')
    expect(etat).toMatchObject({ etat: 'ok', commandesEnCours: false, commandesMessage: 'Échec de test.', clients: 120 })
    // Relancée à la main, la collecte repart des clients puis des commandes.
    await withUserScope(boutique, (tx) => tx.linaSynchro.update({ where: { userId: boutique }, data: { operation: 'gid://shopify/BulkOperation/2|o' } }))
  })

  it('enrichit l’index et garde des totaux par produit, jamais les commandes', async () => {
    vi.mocked(clientsShopify.suivreExport).mockResolvedValueOnce({ statut: 'termine', url: 'https://stockage.example/commandes.jsonl', lus: 360, raison: '' })
    vi.mocked(clientsShopify.telechargerCommandes).mockResolvedValueOnce({ commandes: COMMANDES, tronque: false })
    const etat = await synchroniserLina(boutique, 'suivre')
    expect(etat).toMatchObject({ commandesEnCours: false, commandesMessage: '' })
    expect(etat.analyse?.commandes).toBe(360)

    const client = await withUserScope(boutique, (tx) => tx.linaClient.findFirstOrThrow({ where: { userId: boutique, ref: '10000' } }))
    expect(client.premiereCommande?.toISOString().slice(0, 10)).toBe(ilYA(300).slice(0, 10))
    expect(client.intervalleJours).toBe(50)
    expect(client.produitPrincipal).not.toBeNull()
    const produits = await withUserScope(boutique, (tx) => tx.linaProduit.findMany({ where: { userId: boutique } }))
    expect(produits.map((produit) => produit.titre).sort()).toEqual(['Bougie citrine', 'Grande bougie citrine', 'Recharge'])
    const synchro = await withUserScope(boutique, (tx) => tx.linaSynchro.findFirstOrThrow({ where: { userId: boutique } }))
    expect(JSON.stringify(synchro.analyse)).not.toMatch(/gid:\/\/shopify\/Order|10000/u)
  })

  it('montre réachat, produits complémentaires, montée en gamme, valeur et cohortes', async () => {
    const vue = await lireLina(boutique, { avecNova: false })
    expect(vue.croisees.find((un) => un.vers.titre === 'Recharge')).toMatchObject({ de: { titre: 'Bougie citrine' }, clients: 80 })
    expect(vue.montees.map((un) => un.vers.titre)).toContain('Grande bougie citrine')
    expect(vue.analyse?.reachat.medianeJours).toBe(40)
    expect(vue.analyse?.cohortes.length).toBeGreaterThan(0)
    expect(vue.campagnes.find((campagne) => campagne.cle === 'cross-sell-1-2')?.audience).toBe(40)
    expect(vue.valeur?.observeeCents).toBe(13_500)
    const faits = faitsLina(vue).join('\n')
    expect(faits).toContain('Produits achetés ensuite')
    expect(faits).not.toMatch(/10000|gid:\/\//u)
  })
})

describe('Lina V2 — résultats et audiences', () => {
  it('enregistre des résultats, juge le test A/B, et les supprime', async () => {
    await enregistrerResultat(boutique, { nom: 'Objet A', type: 'reactivation', groupe: 'objet', variante: 'A', envoyeLe: '2026-09-01', envoyes: 2_000, ouvertures: 700, clics: 120, conversions: 20, caCents: 100_000, desinscriptions: 4 })
    const b = await enregistrerResultat(boutique, { nom: 'Objet B', type: 'reactivation', groupe: 'objet', variante: 'B', envoyeLe: '2026-09-01', envoyes: 2_000, ouvertures: 800, clics: 200, conversions: 60, caCents: 300_000, desinscriptions: 3 })
    const resultats = await lireResultats(boutique)
    expect(resultats).toHaveLength(2)
    expect(testsAB(resultats)[0]).toMatchObject({ groupe: 'objet', gagnant: 'B' })
    expect(await lireResultats(voisin)).toHaveLength(0)
    await expect(supprimerResultat(voisin, b.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await supprimerResultat(boutique, b.id)
    expect(await lireResultats(boutique)).toHaveLength(1)
  })

  it('transmet une audience à MIRA avec sa taille, jamais une liste', async () => {
    const vue = await lireLina(boutique, { avecNova: false })
    const audience = vue.audiences.find((un) => un.agent === 'meta')
    expect(audience).toBeDefined()
    await deleguerLina(boutique, { siteId: randomUUID(), cle: `audience-${audience!.cle}`, agent: 'meta' }, 'fr')
    const appel = vi.mocked(visibilite.askVisibility).mock.calls.at(-1)!
    expect(appel[1].agent).toBe('meta')
    expect(appel[1].question).toContain('Lina vous propose une audience')
    expect(appel[1].question).not.toMatch(/\b1\d{4}\b/u)
  })

  it('ne montre à personne les produits d’un autre', async () => {
    expect(await withUserScope(voisin, (tx) => tx.linaProduit.count())).toBe(0)
    expect(await withUserScope(voisin, (tx) => tx.linaResultat.count())).toBe(0)
  })
})
