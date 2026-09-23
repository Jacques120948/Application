import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { connectWithApiKey, storeConnection } from '@/server/integrations/service'
import * as woo from '@/server/integrations/providers/woocommerce'
import * as stripe from '@/server/integrations/providers/stripe-lecture'
import { lireEtatVentes, synchroniserVentes } from '@/server/nova/collecte'
import { synchroniserAbonnements } from '@/server/nova/collecte-stripe'
import { lireNova } from '@/server/nova/service'
import { faitsNova } from '@/server/nova/contexte'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * WooCommerce et Stripe dans Nova, sur une vraie base, sans appeler ni l'un ni l'autre.
 */

vi.mock('@/server/integrations/providers/woocommerce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/woocommerce')>()),
  lireFuseauWoo: vi.fn(async () => 'Europe/Zurich'),
  lireCommandesWoo: vi.fn(),
}))
vi.mock('@/server/integrations/providers/stripe-lecture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/stripe-lecture')>()),
  lireAbonnements: vi.fn(),
  lireEncaissements: vi.fn(),
}))

const JOUR = 24 * 60 * 60 * 1000
let boutique: string
let abonne: string
let voisin: string

const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString()
const jourIlYA = (jours: number) => ilYA(jours).slice(0, 10)

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

function commande(joursAvant: number, totalCents: number) {
  return {
    id: `woo:${randomUUID()}`,
    creeLe: ilYA(joursAvant),
    totalCents,
    devise: 'CHF',
    annulee: false,
    test: false,
    premiere: null,
    visite: null,
    premiereVisite: null,
    clientId: null,
    lignes: [{ produitId: 'woo:1', varianteId: null, titre: 'Savon', quantite: 1, totalCents }],
  }
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  boutique = await creer()
  abonne = await creer()
  voisin = await creer()
  // Une boutique WooCommerce ET un compte Stripe : la boutique fait le chiffre d'affaires.
  await storeConnection(boutique, findProvider('woocommerce')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'https://savons.exemple.ch', cle: 'ck_test', secret: 'cs_secret-de-test' }),
    accountLabel: 'savons.exemple.ch',
  })
  await storeConnection(boutique, findProvider('stripe-revenus')!, { kind: 'API_KEY', secret: 'rk_test_cle-de-test', accountLabel: 'Stripe · mode test' })
  // Stripe seul : ses encaissements font le chiffre d'affaires.
  await storeConnection(abonne, findProvider('stripe-revenus')!, { kind: 'API_KEY', secret: 'rk_test_autre-cle', accountLabel: 'Stripe · mode test' })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [boutique, abonne, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Nova V5 — sources de ventes', () => {
  it('lit WooCommerce quand il n’y a pas de Shopify, et n’y ajoute jamais Stripe', async () => {
    vi.mocked(woo.lireCommandesWoo).mockResolvedValueOnce({ ok: true, commandes: [commande(3, 8_000), commande(4, 4_000)], tronque: false })
    const etat = await synchroniserVentes(boutique, 'manuel')
    expect(etat).toMatchObject({ source: 'woocommerce', nom: 'WooCommerce', etat: 'ok', boutique: 'https://savons.exemple.ch' })
    expect(stripe.lireEncaissements).not.toHaveBeenCalled()
    const jours = await withUserScope(boutique, (tx) => tx.commerceJour.findMany({ where: { userId: boutique } }))
    expect(jours.every((jour) => jour.source === 'woocommerce')).toBe(true)
    expect(jours.reduce((total, jour) => total + Number(jour.chiffreCents), 0)).toBe(12_000)
  })

  it('prend les encaissements Stripe quand aucune boutique n’est reliée', async () => {
    vi.mocked(stripe.lireEncaissements).mockResolvedValueOnce({
      ok: true,
      tronque: false,
      commandes: [{ ...commande(2, 30_000), id: 'stripe:ch_1', lignes: [] }],
    })
    const etat = await synchroniserVentes(abonne, 'manuel')
    expect(etat).toMatchObject({ source: 'stripe', nom: 'Stripe', etat: 'ok' })
    expect((await lireEtatVentes(abonne)).source).toBe('stripe')
  })

  it('calcule les abonnements, et Nova les montre avec la bonne source de ventes', async () => {
    vi.mocked(stripe.lireAbonnements).mockResolvedValueOnce({
      ok: true,
      tronque: false,
      abonnements: [
        { debut: jourIlYA(200), fin: null, mensuelCents: 4_900, devise: 'CHF', essai: false },
        { debut: jourIlYA(100), fin: null, mensuelCents: 9_900, devise: 'CHF', essai: false },
        { debut: jourIlYA(150), fin: jourIlYA(40), mensuelCents: 4_900, devise: 'CHF', essai: false },
      ],
    })
    const etat = await synchroniserAbonnements(boutique, 'manuel')
    expect(etat).toMatchObject({ etat: 'ok', instantane: { mrr: 148, actifs: 2 } })
    // Rien d'identifiant n'est gardé : des chiffres.
    const ligne = await withUserScope(boutique, (tx) => tx.abonnementsSynchro.findFirstOrThrow({ where: { userId: boutique } }))
    expect(JSON.stringify(ligne.instantane)).not.toMatch(/sub_|cus_/u)

    const vue = await lireNova(boutique, 'fr', { periode: '30' })
    expect(vue.sources).toEqual(expect.arrayContaining(['WooCommerce', 'Stripe (abonnements)']))
    expect(vue.kpis.find((kpi) => kpi.cle === 'chiffre')).toMatchObject({ valeur: 120, source: 'WooCommerce, remboursements déduits' })
    expect(vue.abonnements.indicateurs).toMatchObject({ mrr: 148, arr: 1_776, actifs: 2 })
    expect(vue.insights.find((un) => un.cle === 'abonnements.mrr')?.texte).toContain('CHF 148')
    expect(vue.sante.lignes.find((un) => un.cle === 'stripe-abonnements')).toMatchObject({ etat: 'bon' })
    expect(faitsNova(vue).join('\n')).toContain('MRR CHF 148')
  })

  it('ne relit pas Stripe sur une lecture fraîche', async () => {
    vi.mocked(stripe.lireAbonnements).mockClear()
    await synchroniserAbonnements(boutique, 'auto')
    expect(stripe.lireAbonnements).not.toHaveBeenCalled()
  })

  it('refuse d’enregistrer une clé Stripe secrète complète', async () => {
    await expect(connectWithApiKey(voisin, { providerId: 'stripe-revenus', apiKey: 'sk_live_' + 'x'.repeat(30) })).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(await withUserScope(voisin, (tx) => tx.integrationConnection.count({ where: { userId: voisin } }))).toBe(0)
  })

  it('ne montre à personne les ventes ni les abonnements d’un autre', async () => {
    expect(await withUserScope(voisin, (tx) => tx.abonnementsSynchro.count())).toBe(0)
    expect(await withUserScope(voisin, (tx) => tx.commerceJour.count())).toBe(0)
    const vue = await lireNova(voisin, 'fr', { periode: '30' })
    expect(vue.vierge).toBe(true)
    expect(vue.abonnements.indicateurs).toBeNull()
  })
})
