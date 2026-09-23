import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as ga4 from '@/server/integrations/providers/google-analytics'
import { lireEtatVisites, synchroniserVisites, VERSION_JOURS } from '@/server/nova/collecte-ga4'
import { lireNova } from '@/server/nova/service'
import { faitsNova } from '@/server/nova/contexte'
import { contenusPourMilo, conversionPourCleo, traficAssistantsPourGia } from '@/server/nova/transmission'
import { deleguerNova } from '@/server/nova/delegation'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Google Analytics 4 dans Nova, sur une vraie base, sans appeler Google.
 */

vi.mock('@/server/integrations/providers/google-analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/google-analytics')>()),
  listerProprietes: vi.fn(async () => ({
    ok: true,
    proprietes: [
      { id: 'properties/111', nom: 'Autre site', compte: 'Compte' },
      { id: 'properties/222', nom: 'Boutique test', compte: 'Compte' },
    ],
  })),
  lireReglagesPropriete: vi.fn(async () => ({ fuseau: 'Europe/Zurich', devise: 'CHF' })),
  rapport: vi.fn(),
}))

const JOUR = 24 * 60 * 60 * 1000
let proprietaire: string
let voisin: string

function dateGa4(joursAvant: number): string {
  return new Date(Date.now() - joursAvant * JOUR).toISOString().slice(0, 10).replaceAll('-', '')
}

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  proprietaire = await creer()
  voisin = await creer()
  await storeConnection(proprietaire, findProvider('google-analytics')!, {
    kind: 'OAUTH',
    secret: 'jeton-acces-test',
    accountLabel: 'Boutique test',
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  vi.mocked(ga4.rapport).mockImplementation(async (_jeton, _propriete, demande) => {
    if (demande.dimensions.includes('sessionDefaultChannelGroup')) {
      return {
        ok: true,
        lignes: [
          { dimensions: [dateGa4(3), 'Organic Search', 'google', 'organic', 'mobile'], metriques: [400, 200, 2, 120] },
          { dimensions: [dateGa4(3), 'Organic Search', 'google', 'organic', 'desktop'], metriques: [100, 70, 3, 180] },
          { dimensions: [dateGa4(3), 'Referral', 'chatgpt.com', 'referral', 'desktop'], metriques: [12, 10, 0, 0] },
        ],
      }
    }
    return {
      ok: true,
      lignes: [
        { dimensions: [dateGa4(3), '/bougies'], metriques: [300, 4, 250, 150] },
        { dimensions: [dateGa4(3), '/blogs/journal/rituel-du-soir'], metriques: [80, 0, 0, 70] },
      ],
    }
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [proprietaire, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Nova V3 — Google Analytics 4', () => {
  it('choisit une propriété, lit les visites et n’en garde que des totaux', async () => {
    const etat = await synchroniserVisites(proprietaire, 'manuel')
    expect(etat).toMatchObject({ etat: 'ok', propriete: 'properties/111', devise: 'CHF' })
    const jours = await withUserScope(proprietaire, (tx) => tx.analyticsJour.findMany({ where: { userId: proprietaire } }))
    expect(jours).toHaveLength(1)
    expect(jours[0]).toMatchObject({ sessions: 512, achats: 5 })
    expect(jours[0]!.canaux).toMatchObject({ seo: { sessions: 500 }, ia: { sessions: 12 } })
  })

  it('garde l’engagement par page, et relit tout quand la forme des jours a changé', async () => {
    const jour = await withUserScope(proprietaire, (tx) => tx.analyticsJour.findFirstOrThrow({ where: { userId: proprietaire } }))
    expect(jour.pages).toEqual(expect.arrayContaining([expect.objectContaining({ page: '/blogs/journal/rituel-du-soir', engagees: 70 })]))
    const synchro = await withUserScope(proprietaire, (tx) => tx.analyticsSynchro.findFirstOrThrow({ where: { userId: proprietaire } }))
    expect(synchro.version).toBe(VERSION_JOURS)

    // Une ligne écrite par une version plus ancienne : la lecture automatique relit toute la fenêtre.
    await withUserScope(proprietaire, (tx) =>
      tx.analyticsSynchro.updateMany({ where: { userId: proprietaire }, data: { version: 1, synchroAt: new Date(Date.now() - 13 * 3_600_000) } }),
    )
    vi.mocked(ga4.rapport).mockClear()
    await synchroniserVisites(proprietaire, 'auto')
    const demande = vi.mocked(ga4.rapport).mock.calls[0]![2]
    expect(demande.du <= new Date(Date.now() - 170 * 86_400_000).toISOString().slice(0, 10)).toBe(true)
  })

  it('ne rappelle pas Google sur une lecture fraîche', async () => {
    vi.mocked(ga4.rapport).mockClear()
    await synchroniserVisites(proprietaire, 'auto')
    expect(ga4.rapport).not.toHaveBeenCalled()
  })

  it('donne à Nova le taux de conversion, les appareils, et à Gia le trafic des IA', async () => {
    const vue = await lireNova(proprietaire, 'fr', { periode: '30' })
    expect(vue.sources).toContain('Google Analytics 4')
    // Sans boutique : les achats vus par GA4 sur les visites de GA4.
    expect(vue.kpis.find((kpi) => kpi.cle === 'conversion')).toMatchObject({ valeur: 1, source: 'Achats ÷ visites, selon GA4' })
    expect(vue.visitesPeriode?.appareils.mobile).toEqual({ sessions: 400, achats: 2 })
    expect(vue.canaux.find((ligne) => ligne.canal === 'ia')).toMatchObject({ sessions: 12 })
    expect(vue.sante.lignes.find((ligne) => ligne.cle === 'ga4')).toMatchObject({ etat: 'bon' })
    expect(faitsNova(vue).join('\n')).toContain('Visites venues d’assistants IA : 12')
    expect(await traficAssistantsPourGia(proprietaire)).toContain('12 visites venues d’assistants IA — chatgpt.com 12')
    // Milo reçoit les articles qui retiennent, Cleo les taux par appareil — et Nova les affiche.
    expect(vue.contenus.lignes).toEqual([expect.objectContaining({ page: '/blogs/journal/rituel-du-soir', sessions: 80 })])
    expect(await contenusPourMilo(proprietaire)).toContain('/blogs/journal/rituel-du-soir — 80 visites, 88 % engagées')
    expect(await conversionPourCleo(proprietaire)).toContain('mobile 0,5 % (400 visites)')
  })

  it('ne transmet rien sans site analysé, ni un point que Nova n’a pas calculé', async () => {
    await expect(deleguerNova(proprietaire, { cle: 'cleo.mobile', agent: 'cro' }, 'fr')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(deleguerNova(voisin, { cle: 'n-importe-quoi', agent: 'ads' }, 'fr')).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('ne montre à personne les visites d’un autre', async () => {
    expect((await lireEtatVisites(voisin)).etat).toBe('absent')
    expect(await withUserScope(voisin, (tx) => tx.analyticsJour.count({ where: { userId: proprietaire } }))).toBe(0)
    expect(await withUserScope(voisin, (tx) => tx.analyticsSynchro.count())).toBe(0)
    expect(await traficAssistantsPourGia(voisin)).toBeNull()
  })
})
