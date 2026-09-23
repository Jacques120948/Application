import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as shopify from '@/server/integrations/providers/shopify'
import type { CommandeShopify } from '@/server/integrations/providers/shopify'
import { synchroniserVentes } from '@/server/nova/collecte'
import { lireNova } from '@/server/nova/service'
import { faitsNova, transmissionOria } from '@/server/nova/contexte'
import { lireSignaux } from '@/server/oria/signaux'
import { enregistrerReglages, reglagesNova } from '@/server/nova/reglages'
import { lireBilan } from '@/server/nova/bilan'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Nova de bout en bout, sur une vraie base, sans appeler Shopify.
 *
 * Le connecteur est remplacé par un faux : ce qui est éprouvé est ce qui nous appartient —
 * la collecte n'écrit que des totaux, ne relit pas une boutique fraîche, dit ce qui manque,
 * et chacun ne voit que ses propres ventes.
 */

vi.mock('@/server/integrations/providers/shopify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/shopify')>()),
  frapperJeton: vi.fn(async () => ({ ok: true, jeton: 'jeton-test' })),
  lirePortees: vi.fn(async () => ['read_orders', 'read_products']),
  lireReglagesBoutique: vi.fn(async () => ({ fuseau: 'Europe/Zurich', devise: 'CHF' })),
  lireCommandes: vi.fn(),
}))

const JOUR = 24 * 60 * 60 * 1000
let proprietaire: string
let voisin: string

function ilYA(jours: number): string {
  return new Date(Date.now() - jours * JOUR).toISOString()
}

function commande(partiel: Partial<CommandeShopify>): CommandeShopify {
  return {
    id: `gid://shopify/Order/${randomUUID()}`,
    creeLe: ilYA(3),
    totalCents: 10_000,
    devise: 'CHF',
    annulee: false,
    test: false,
    premiere: true,
    visite: null,
    premiereVisite: null,
    clientId: null,
    lignes: [{ produitId: 'gid://shopify/Product/1', titre: 'Bougie citrine', quantite: 1, totalCents: 10_000 }],
    ...partiel,
  }
}

async function creer(): Promise<string> {
  const { userId } = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  proprietaire = await creer()
  voisin = await creer()
  await storeConnection(proprietaire, findProvider('shopify')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'nova-test.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
    accountLabel: 'nova-test.myshopify.com',
  })

  // Un compte Google Ads, en francs, avec une campagne et deux jours de dépense.
  await withUserScope(proprietaire, async (tx) => {
    const compte = await tx.adsAccount.create({
      data: { userId: proprietaire, plateforme: 'google-ads', compteId: '1234567890', devise: 'CHF', fuseau: 'Europe/Zurich', actif: true, synchroAt: new Date() },
    })
    const campagne = await tx.adsCampagne.create({
      data: { userId: proprietaire, accountId: compte.id, campagneId: 'c-1', nom: 'Bougies — Recherche', statut: 'ENABLED' },
    })
    for (const jours of [3, 4]) {
      await tx.adsReleve.create({
        data: {
          userId: proprietaire,
          accountId: compte.id,
          campagneId: campagne.id,
          jour: new Date(ilYA(jours).slice(0, 10)),
          coutMicros: BigInt(50_000_000),
          clics: BigInt(100),
          impressions: BigInt(2_000),
          conversions: 2,
          valeurConversion: 250,
        },
      })
    }
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [proprietaire, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Nova — collecte des ventes', () => {
  it('écrit des totaux par jour, sans rien garder d’un client', async () => {
    vi.mocked(shopify.lireCommandes).mockResolvedValueOnce({
      commandes: [
        commande({
          totalCents: 12_000,
          clientId: 'gid://shopify/Customer/1',
          visite: { source: '', referrer: 'https://www.google.com/?gclid=x', utm: { source: '', medium: '', campaign: '', content: '', term: '' } },
          premiereVisite: { source: '', referrer: 'https://www.instagram.com/', utm: { source: '', medium: '', campaign: '', content: '', term: '' } },
        }),
        commande({ totalCents: 8_000, premiere: false, clientId: 'gid://shopify/Customer/2' }),
        commande({ totalCents: 99_999, test: true }),
      ],
      tronque: false,
      parcours: true,
      client: true,
    })
    const etat = await synchroniserVentes(proprietaire, 'manuel')
    expect(etat).toMatchObject({ etat: 'ok', devise: 'CHF', boutique: 'nova-test.myshopify.com' })
    // Sans read_all_orders, Shopify ne rend que soixante jours : c'est ce qui est annoncé.
    expect(etat.couvertureDepuis! >= ilYA(60).slice(0, 10)).toBe(true)

    const jours = await withUserScope(proprietaire, (tx) => tx.commerceJour.findMany({ where: { userId: proprietaire } }))
    expect(jours).toHaveLength(1)
    expect(jours[0]).toMatchObject({ commandes: 2, chiffreCents: BigInt(20_000), nouveauxClients: 1, clientsIdentifies: 2 })
    expect(jours[0]!.chiffreNouveauxCents).toBe(BigInt(12_000))
    expect(jours[0]!.canauxPremier).toMatchObject({ social: { commandes: 1 } })
    // Le compte des clients est gardé ; leurs identifiants, non.
    expect(etat.clients).toMatchObject({ clients: 2, recurrents: 0, commandes: 2 })
    const synchro = await withUserScope(proprietaire, (tx) => tx.commerceSynchro.findFirstOrThrow({ where: { userId: proprietaire } }))
    expect(JSON.stringify(synchro.clients)).not.toContain('Customer')
    expect(JSON.stringify(jours[0], (_, valeur: unknown) => (typeof valeur === 'bigint' ? String(valeur) : valeur))).not.toContain('gid://shopify/Order')
  })

  it('ne relit pas une boutique fraîche à l’ouverture', async () => {
    vi.mocked(shopify.lireCommandes).mockClear()
    await synchroniserVentes(proprietaire, 'auto')
    expect(shopify.lireCommandes).not.toHaveBeenCalled()
  })

  it('dit quelle autorisation manque, sans effacer les ventes déjà lues', async () => {
    vi.mocked(shopify.lirePortees).mockResolvedValueOnce(['read_products'])
    // Sous le périmètre de la personne : hors de lui, la sécurité au niveau des lignes ne laisse rien modifier.
    await withUserScope(proprietaire, (tx) =>
      tx.commerceSynchro.updateMany({ where: { userId: proprietaire }, data: { essaiAt: new Date(Date.now() - 10 * 60_000) } }),
    )
    const etat = await synchroniserVentes(proprietaire, 'manuel')
    expect(etat.etat).toBe('portee')
    expect(etat.message).toContain('read_orders')
    expect(await withUserScope(proprietaire, (tx) => tx.commerceJour.count({ where: { userId: proprietaire } }))).toBe(1)
    // Remise en état pour la suite.
    await withUserScope(proprietaire, (tx) =>
      tx.commerceSynchro.updateMany({ where: { userId: proprietaire }, data: { etat: 'ok', message: '' } }),
    )
  })
})

describe('Nova — lecture', () => {
  it('rassemble ventes et dépenses sans appeler personne', async () => {
    vi.mocked(shopify.lireCommandes).mockClear()
    const vue = await lireNova(proprietaire, 'fr', { periode: '30' })
    expect(shopify.lireCommandes).not.toHaveBeenCalled()
    expect(vue.vierge).toBe(false)
    expect(vue.sources).toEqual(['Shopify', 'Google Ads'])
    const kpi = Object.fromEntries(vue.kpis.map((un) => [un.cle, un.valeur]))
    expect(kpi).toMatchObject({ chiffre: 200, depenses: 100, roas: 500, mer: 200, commandes: 2, cac: 100, panier: 100 })
    expect(vue.attribution.plateformes).toEqual([{ plateforme: 'google-ads', nom: 'Google Ads', conversions: 4, revenu: 500 }])
    // Google revendique 500 pour 200 encaissés : la santé des données le signale.
    expect(vue.sante.lignes.some((ligne) => ligne.cle === 'doublons')).toBe(true)
    expect(vue.campagnes[0]).toMatchObject({ nom: 'Bougies — Recherche', depenses: 100, roas: 500 })
    expect(vue.produits[0]).toMatchObject({ titre: 'Bougie citrine', commandes: 2 })
  })

  it('transmet des faits sourcés à la conversation et à Oria', async () => {
    const vue = await lireNova(proprietaire, 'fr', { periode: '30' })
    const faits = faitsNova(vue).join('\n')
    expect(faits).toContain('Sources : Shopify + Google Ads')
    expect(faits).toContain('Taux de conversion : indisponible')
    expect(transmissionOria(vue)[0]).toContain('NOVA → ORIA')
    const oria = await lireSignaux(proprietaire, 'fr')
    expect(oria.sourcesLues).toContain('nova')
  })

  it('estime une marge et suit un objectif d’après les réglages saisis', async () => {
    await enregistrerReglages(proprietaire, { activite: 'ecommerce', objectifs: { cacMax: 50 }, couts: { coutProduitPct: 40 } })
    const vue = await lireNova(proprietaire, 'fr', { periode: '30' })
    // 200 − 80 produits − 100 publicité ; livraison, paiement, commissions et autres non renseignés.
    expect(vue.marge).toMatchObject({ etat: 'calculee', marge: 20 })
    expect(vue.objectifs.find((un) => un.cle === 'cacMax')).toMatchObject({ actuel: 100, tendance: 'hors-cible' })
    expect(vue.modeles?.find((ligne) => ligne.canal === 'social')?.chiffre.premier).toBe(120)
    expect(faitsNova(vue).join('\n')).toContain('Valeur client / LTV : indisponible — Moins de 20 clients')
  })

  it('compose le bilan de la dernière semaine terminée', async () => {
    const bilan = await lireBilan(proprietaire, 'fr')
    expect(bilan.vue.periode.cle).toBe('perso')
    expect(bilan.vue.periode.jours).toBe(7)
    expect(bilan.chiffres.map((kpi) => kpi.cle)).toEqual(['chiffre', 'depenses', 'roas', 'cac', 'commandes'])
  })

  it('ne montre à personne les ventes d’un autre', async () => {
    expect(await reglagesNova(voisin)).toEqual({ activite: '', objectifs: {}, couts: {} })
    expect(await withUserScope(voisin, (tx) => tx.novaReglages.count())).toBe(0)
    const vue = await lireNova(voisin, 'fr', { periode: '30' })
    expect(vue.vierge).toBe(true)
    expect(vue.kpis.find((un) => un.cle === 'chiffre')?.valeur).toBeNull()
    expect(await withUserScope(voisin, (tx) => tx.commerceJour.count({ where: { userId: proprietaire } }))).toBe(0)
    expect(await withUserScope(voisin, (tx) => tx.commerceSynchro.count())).toBe(0)
  })
})
