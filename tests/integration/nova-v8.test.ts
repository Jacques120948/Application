import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as hubspot from '@/server/integrations/providers/hubspot'
import { lireEtatVentes } from '@/server/nova/collecte'
import { synchroniserCrm } from '@/server/nova/collecte-crm'
import { lireNova } from '@/server/nova/service'
import { faitsNova } from '@/server/nova/contexte'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * HubSpot dans Nova, sur une vraie base, sans appeler HubSpot.
 */

vi.mock('@/server/integrations/providers/hubspot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/hubspot')>()),
  lireCompteHubspot: vi.fn(async () => ({ fuseau: 'Europe/Zurich', devise: 'CHF' })),
  lireContacts: vi.fn(),
  lireAffaires: vi.fn(),
}))

const JOUR = 24 * 60 * 60 * 1000
/** Assemblé ici pour que les détecteurs de secrets ne le prennent pas pour un vrai jeton. */
const JETON_FACTICE = ['pat', 'eu1', '00000000-0000-0000-0000-000000000000'].join('-')
let equipe: string
let voisin: string

const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString()

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  equipe = await creer()
  voisin = await creer()
  await storeConnection(equipe, findProvider('hubspot')!, { kind: 'API_KEY', secret: JETON_FACTICE, accountLabel: 'HubSpot · portail 42' })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [equipe, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Nova V8 — CRM HubSpot', () => {
  it('lit les prospects et les clients, sans rien garder qui identifie un contact', async () => {
    // Vingt-cinq prospects du référencement il y a deux mois et demi, cinq devenus clients ;
    // dix prospects Meta la semaine dernière, aucun client encore.
    const contacts = [
      ...Array.from({ length: 25 }, (_, i) => ({ cree: ilYA(75), client: i < 5 ? ilYA(60) : null, source: 'ORGANIC_SEARCH' })),
      ...Array.from({ length: 10 }, () => ({ cree: ilYA(5), client: null, source: 'PAID_SOCIAL' })),
    ]
    vi.mocked(hubspot.lireContacts).mockResolvedValueOnce({ ok: true, contacts, tronque: false })
    vi.mocked(hubspot.lireAffaires).mockResolvedValueOnce({
      ok: true,
      tronque: false,
      affaires: [
        { gagnee: ilYA(10), creee: ilYA(40), montantCents: 250_000, devise: 'CHF', source: 'ORGANIC_SEARCH' },
        { gagnee: ilYA(3), creee: ilYA(20), montantCents: 150_000, devise: 'CHF', source: 'PAID_SOCIAL' },
      ],
    })

    const etat = await synchroniserCrm(equipe, 'manuel')
    expect(etat).toMatchObject({ etat: 'ok', tronque: false })
    expect(etat.instantane?.affaires).toBe(2)

    const jours = await withUserScope(equipe, (tx) => tx.crmJour.findMany({ where: { userId: equipe } }))
    expect(jours.reduce((total, jour) => total + jour.prospects, 0)).toBe(35)
    expect(jours.reduce((total, jour) => total + jour.clients, 0)).toBe(5)
    const ligne = await withUserScope(equipe, (tx) => tx.crmSynchro.findFirstOrThrow({ where: { userId: equipe } }))
    expect(JSON.stringify(ligne)).not.toMatch(/pat-|@/u)
  })

  it('fait des transactions gagnées la source de ventes quand rien d’autre n’est relié', async () => {
    const ventes = await lireEtatVentes(equipe)
    expect(ventes).toMatchObject({ source: 'hubspot', nom: 'HubSpot', etat: 'ok' })
    const jours = await withUserScope(equipe, (tx) => tx.commerceJour.findMany({ where: { userId: equipe } }))
    expect(jours.every((jour) => jour.source === 'hubspot')).toBe(true)
    expect(jours.reduce((total, jour) => total + Number(jour.chiffreCents), 0)).toBe(400_000)
  })

  it('montre prospects, clients signés et taux par cohorte dans Nova', async () => {
    const vue = await lireNova(equipe, 'fr', { periode: '90' })
    expect(vue.crm.etat).toBe('ok')
    expect(vue.kpis.find((kpi) => kpi.cle === 'leads')).toMatchObject({ valeur: 35, source: expect.stringContaining('HubSpot') })
    expect(vue.kpis.find((kpi) => kpi.cle === 'signes')?.valeur).toBe(5)
    expect(vue.lectureCrm?.global).toMatchObject({ prospects: 25, clients: 5, taux: 0.2 })
    expect(vue.lectureCrm?.parCanal.map((ligne) => ligne.cle)).toEqual(['seo', 'meta-ads'])
    expect(vue.sante.lignes.find((un) => un.cle === 'crm')).toMatchObject({ etat: 'bon' })
    expect(faitsNova(vue).join('\n')).toMatch(/HubSpot|prospects/u)
  })

  it('ne relit pas HubSpot sur une lecture fraîche', async () => {
    vi.mocked(hubspot.lireContacts).mockClear()
    await synchroniserCrm(equipe, 'auto')
    expect(hubspot.lireContacts).not.toHaveBeenCalled()
  })

  it('garde les derniers chiffres quand HubSpot refuse, et le dit', async () => {
    vi.mocked(hubspot.lireContacts).mockResolvedValueOnce({ ok: false, raison: 'HubSpot refuse ce jeton.' })
    vi.mocked(hubspot.lireAffaires).mockResolvedValueOnce({ ok: true, affaires: [], tronque: false })
    const etat = await synchroniserCrm(equipe, 'manuel', new Date(Date.now() + 10 * 60 * 1000))
    expect(etat).toMatchObject({ etat: 'erreur', message: 'HubSpot refuse ce jeton.' })
    expect(etat.instantane?.affaires).toBe(2)
    expect(await withUserScope(equipe, (tx) => tx.crmJour.count({ where: { userId: equipe } }))).toBeGreaterThan(0)
  })

  it('ne montre à personne le CRM d’un autre', async () => {
    expect(await withUserScope(voisin, (tx) => tx.crmJour.count())).toBe(0)
    expect(await withUserScope(voisin, (tx) => tx.crmSynchro.count())).toBe(0)
    const vue = await lireNova(voisin, 'fr', { periode: '30' })
    expect(vue.crm.etat).toBe('absent')
    expect(vue.lectureCrm).toBeNull()
  })
})
