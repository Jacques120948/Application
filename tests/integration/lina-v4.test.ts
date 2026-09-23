import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as woo from '@/server/integrations/providers/woocommerce'
import * as stripe from '@/server/integrations/providers/stripe-lecture'
import * as clientsShopify from '@/server/integrations/providers/shopify-clients'
import { pseudonyme } from '@/server/lina/collecte-autres'
import { synchroniserLina } from '@/server/lina/collecte'
import { creerSegmentAssiste, enregistrerAutonomie, lireActions } from '@/server/lina/assiste'
import { lireFicheClient, lireLina } from '@/server/lina/service'
import { faitsLina } from '@/server/lina/contexte'
import { lundiDe } from '@/server/lina/releves'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Lina V4 sur une vraie base : une boutique WooCommerce et un compte Stripe deviennent des
 * bases clients sans qu'aucune commande ni aucun courriel ne soit écrit ; la fiche client ne
 * montre rien d'identifiant ; le segment Shopify ne se crée que sur validation, en mode
 * assisté ; les alertes ne se notifient qu'une fois.
 */

vi.mock('@/server/integrations/providers/woocommerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/woocommerce')>()),
  lireFuseauWoo: vi.fn(async () => 'Europe/Zurich'),
  lireCommandesClientsWoo: vi.fn(),
}))
vi.mock('@/server/integrations/providers/stripe-lecture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/stripe-lecture')>()),
  lireEncaissementsClients: vi.fn(),
}))
vi.mock('@/server/integrations/providers/shopify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify')>()),
  frapperJeton: vi.fn(async () => ({ ok: true, jeton: 'jeton-test' })),
}))
vi.mock('@/server/integrations/providers/shopify-clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify-clients')>()),
  creerSegmentShopify: vi.fn(async () => ({ ok: true, id: 'gid://shopify/Segment/99' })),
}))

const JOUR = 24 * 60 * 60 * 1000
const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString()
let boutiqueWoo: string
let abonnesStripe: string
let boutiqueShopify: string
let voisin: string

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

// 40 clients inscrits (deux commandes chacun) et 10 achats sans compte (une commande).
const ligne = { produitRef: '9', titre: 'Bougie', type: '', quantite: 1, prixUnitaireCents: 4_000 }
const COMMANDES_WOO: woo.CommandeExportWoo[] = [
  ...Array.from({ length: 40 }, (_, i) => [
    { id: `woo:${i}a`, creeLe: ilYA(300), clientRef: `c${100 + i}`, totalCents: 4_000, devise: 'CHF', lignes: [ligne] },
    { id: `woo:${i}b`, creeLe: ilYA(i < 20 ? 20 : 200), clientRef: `c${100 + i}`, totalCents: 4_000, devise: 'CHF', lignes: [ligne] },
  ]).flat(),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `woo:g${i}`, creeLe: ilYA(15), clientRef: `g${pseudonyme(`invite${i}@exemple.ch`)}`, totalCents: 3_000, devise: 'CHF', lignes: [ligne] })),
]

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  ;[boutiqueWoo, abonnesStripe, boutiqueShopify, voisin] = await Promise.all([creer(), creer(), creer(), creer()])
  await storeConnection(boutiqueWoo, findProvider('woocommerce')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'https://bougies.exemple.ch', cle: 'ck_test', secret: 'cs_secret-de-test' }),
    accountLabel: 'bougies.exemple.ch',
  })
  await storeConnection(abonnesStripe, findProvider('stripe-revenus')!, { kind: 'API_KEY', secret: ['rk', 'test', 'cle-de-test'].join('_'), accountLabel: 'Stripe · mode test' })
  await storeConnection(boutiqueShopify, findProvider('shopify')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'lina-v4.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
    accountLabel: 'lina-v4.myshopify.com',
  })
  // Une base Shopify déjà lue : 60 acheteurs, dont 12 gros clients récurrents.
  await withUserScope(boutiqueShopify, async (tx) => {
    await tx.linaSynchro.create({ data: { userId: boutiqueShopify, source: 'shopify', etat: 'ok', synchroAt: new Date(), clients: 60, consentement: true } })
    await tx.linaClient.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        userId: boutiqueShopify,
        source: 'shopify',
        ref: String(30_000 + i),
        creeLe: new Date(ilYA(500)),
        derniereCommande: new Date(ilYA(i < 30 ? 20 : 250)),
        commandes: i < 12 ? 4 : 1,
        caCents: i < 12 ? 60_000 : 5_000,
        devise: 'CHF',
        consentement: 'oui',
      })),
    })
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [boutiqueWoo, abonnesStripe, boutiqueShopify, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Lina V4 — WooCommerce', () => {
  it('reconstruit la base à partir des commandes, sans rien garder d’identifiant', async () => {
    vi.mocked(woo.lireCommandesClientsWoo).mockResolvedValueOnce({ ok: true, commandes: COMMANDES_WOO, tronque: false, sansClient: 3 })
    const etat = await synchroniserLina(boutiqueWoo, 'manuel')
    expect(etat).toMatchObject({ etat: 'ok', source: 'woocommerce', clients: 50, sansClient: 3, consentement: false })
    const lignes = await withUserScope(boutiqueWoo, (tx) => tx.linaClient.findMany({ where: { userId: boutiqueWoo } }))
    expect(lignes).toHaveLength(50)
    expect(lignes.every((un) => un.source === 'woocommerce' && un.consentement === 'inconnu')).toBe(true)
    expect(JSON.stringify(lignes)).not.toMatch(/@|invite/u)
    const synchro = await withUserScope(boutiqueWoo, (tx) => tx.linaSynchro.findFirstOrThrow({ where: { userId: boutiqueWoo } }))
    expect(JSON.stringify(synchro)).not.toMatch(/woo:\d|@/u)
  })

  it('parle de l’outil d’envoi, jamais d’une requête Shopify', async () => {
    const vue = await lireLina(boutiqueWoo, { avecNova: false })
    expect(vue.vierge).toBe(false)
    expect(vue.indicateurs).toMatchObject({ acheteurs: 50, recurrents: 40 })
    expect(vue.segments.every((segment) => segment.requeteShopify === null)).toBe(true)
    expect(vue.campagnes.every((campagne) => campagne.requeteShopify === null)).toBe(true)
    expect(JSON.stringify([vue.campagnes, vue.scenarios, vue.sante]).replaceAll('"requeteShopify"', '')).not.toContain('Shopify')
    expect(vue.sante.map((un) => un.cle)).toEqual(expect.arrayContaining(['limite-0', 'sans-client', 'fenetre']))
    expect(faitsLina(vue).join('\n')).toContain('commandes WooCommerce')
  })

  it('montre la fiche d’un client, sans nom, avec le lien vers WordPress', async () => {
    const fiche = await lireFicheClient(boutiqueWoo, 'c100')
    expect(fiche).toMatchObject({ numero: 'Client n° 100', commandes: 2, caCents: 8_000, panierMoyenCents: 4_000 })
    expect(fiche?.lien?.href).toBe('https://bougies.exemple.ch/wp-admin/user-edit.php?user_id=100')
    expect(fiche?.segments).toContain('Clients récurrents')
    expect(await lireFicheClient(voisin, 'c100')).toBeNull()
  })

  it('refuse de créer un segment Shopify pour une boutique WooCommerce', async () => {
    await expect(creerSegmentAssiste(boutiqueWoo, { type: 'segment', cle: 'recurrents' })).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(clientsShopify.creerSegmentShopify).not.toHaveBeenCalled()
  })
})

describe('Lina V4 — Stripe', () => {
  it('fait des clients Stripe une base, sans produits', async () => {
    vi.mocked(stripe.lireEncaissementsClients).mockResolvedValueOnce({
      ok: true,
      tronque: false,
      sansClient: 0,
      commandes: Array.from({ length: 30 }, (_, i) => ({ id: `stripe:ch_${i}`, creeLe: ilYA(10 + i), clientRef: `cus_${i % 25}`, totalCents: 4_900, devise: 'CHF', lignes: [] as [] })),
    })
    const etat = await synchroniserLina(abonnesStripe, 'manuel')
    expect(etat).toMatchObject({ etat: 'ok', source: 'stripe', clients: 25 })
    const vue = await lireLina(abonnesStripe, { avecNova: false })
    expect(vue.produits).toEqual([])
    expect((await lireFicheClient(abonnesStripe, 'cus_1'))?.lien?.href).toBe('https://dashboard.stripe.com/customers/cus_1')
  })
})

describe('Lina V4 — mode assisté', () => {
  it('crée le segment VIP dans Shopify sur validation, et le journalise', async () => {
    const resultat = await creerSegmentAssiste(boutiqueShopify, { type: 'segment', cle: 'vip' })
    expect(resultat.nom).toMatch(/^Lina — VIP \(/u)
    expect(resultat.lien).toBe('https://lina-v4.myshopify.com/admin/customers/segments/99')
    const [, , nom, requete] = vi.mocked(clientsShopify.creerSegmentShopify).mock.calls.at(-1)!
    expect(nom).toBe(resultat.nom)
    // La requête est celle que le serveur a calculée, restreinte aux clients qui acceptent les emails.
    expect(requete).toMatch(/amount_spent >= .* AND number_of_orders >= 2/u)
    const actions = await lireActions(boutiqueShopify)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'segment-shopify', cle: 'segment:vip', refExterne: 'gid://shopify/Segment/99' })
    expect(await lireActions(voisin)).toEqual([])
  })

  it('n’exécute rien en mode conseil', async () => {
    await enregistrerAutonomie(boutiqueShopify, 'conseil')
    const avant = vi.mocked(clientsShopify.creerSegmentShopify).mock.calls.length
    await expect(creerSegmentAssiste(boutiqueShopify, { type: 'segment', cle: 'vip' })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(vi.mocked(clientsShopify.creerSegmentShopify).mock.calls.length).toBe(avant)
    await enregistrerAutonomie(boutiqueShopify, 'assiste')
  })

  it('refuse un segment inconnu', async () => {
    await expect(creerSegmentAssiste(boutiqueShopify, { type: 'campagne', cle: 'inventee' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Lina V4 — alertes notifiées', () => {
  it('notifie une nouvelle baisse une seule fois dans la semaine', async () => {
    const ancienne = new Date(`${lundiDe(new Date(Date.now() - 35 * JOUR))}T00:00:00Z`)
    await withUserScope(boutiqueShopify, (tx) =>
      tx.linaReleve.create({
        data: {
          userId: boutiqueShopify,
          semaine: ancienne,
          donnees: {
            au: ancienne.toISOString(), acheteurs: 60, actifs: 40, nouveaux: 0, recurrents: 30, fideles: 10, tauxReachat: 0.5, panierMoyenCents: 5000,
            caRecurrentsCents: 700_000, partCaRecurrents: 0.7, aReactiver: 0, dormants: 10, aRisque: 0, vip: 3, vipInactifs: 0,
            paniers: null, reactives30: null, caExistants30Cents: null, score: 80,
          },
        },
      }),
    )
    const vue = await lireLina(boutiqueShopify, { avecNova: false })
    expect(vue.alertes.map((alerte) => alerte.cle)).toContain('reachat-baisse')
    await lireLina(boutiqueShopify, { avecNova: false })
    const notifications = await withUserScope(boutiqueShopify, (tx) => tx.notification.findMany({ where: { userId: boutiqueShopify, kind: 'lina_alerte' } }))
    expect(notifications.filter((un) => /réachat/u.test(un.title))).toHaveLength(1)
    expect(notifications[0]?.href).toBe('/fr/lina/bilan')
    expect(await withUserScope(voisin, (tx) => tx.notification.count({ where: { kind: 'lina_alerte' } }))).toBe(0)
  })
})
