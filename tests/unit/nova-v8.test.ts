import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyHubspotToken } from '@/server/integrations/providers/hubspot'
import { canalHubspot } from '@/server/nova/canaux'
import { agregerCrm } from '@/server/nova/agregat-crm'
import { canalQuiNeSignePas, lireCrm } from '@/server/nova/crm'
import { agregerVisites } from '@/server/nova/agregat-ga4'
import { cumulCrm, ensemble, indicateursNova, type Donnees } from '@/server/nova/metriques'
import { lireAudiences } from '@/server/nova/audiences'
import { cumulVisites } from '@/server/nova/metriques'

describe('Nova V8 — HubSpot', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuse ce qui n’est pas un jeton d’application privée, sans rien appeler', async () => {
    const appel = vi.fn()
    vi.stubGlobal('fetch', appel)
    expect(await verifyHubspotToken('un-mot-de-passe')).toMatchObject({ ok: false })
    expect(appel).not.toHaveBeenCalled()
  })

  it('nomme le droit qui manque quand HubSpot refuse les transactions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ results: [] }), { status: String(url).includes('deals') ? 403 : 200 })))
    expect(await verifyHubspotToken(['pat', 'eu1', '0123abcd-0123-4567-89ab-0123456789ab'].join('-'))).toMatchObject({ ok: false, reason: expect.stringContaining('crm.objects.deals.read') })
  })

  it('range les sources de HubSpot dans les canaux de Nova', () => {
    expect(canalHubspot('ORGANIC_SEARCH').canal).toBe('seo')
    expect(canalHubspot('paid_social').canal).toBe('meta-ads')
    expect(canalHubspot('AI_REFERRALS').canal).toBe('ia')
    expect(canalHubspot('').canal).toBe('inconnu')
  })
})

describe('Nova V8 — du CRM aux journées', () => {
  const contacts = [
    ...Array.from({ length: 30 }, (_, i) => ({ cree: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`, client: i < 6 ? '2026-07-10T10:00:00Z' : null, source: 'ORGANIC_SEARCH' })),
    ...Array.from({ length: 25 }, (_, i) => ({ cree: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T11:00:00Z`, client: null, source: 'PAID_SOCIAL' })),
    // Un prospect d'avant la fenêtre qui signe dedans : compté comme client, pas comme prospect.
    { cree: '2026-01-10T10:00:00Z', client: '2026-08-01T10:00:00Z', source: 'REFERRALS' },
  ]
  const affaires = [
    { gagnee: '2026-07-10T15:00:00Z', creee: '2026-06-30T15:00:00Z', montantCents: 250_000, devise: 'CHF', source: 'ORGANIC_SEARCH' },
    { gagnee: '2026-08-01T15:00:00Z', creee: '2026-07-22T15:00:00Z', montantCents: 180_000, devise: 'CHF', source: 'REFERRALS' },
  ]

  it('compte prospects, clients et transactions, sans rien garder d’un contact', () => {
    const { jours, ventes, instantane } = agregerCrm(contacts, affaires, 'Europe/Zurich', '2026-04-01', '2026-09-23')
    expect(jours.reduce((total, jour) => total + jour.prospects, 0)).toBe(55)
    expect(jours.reduce((total, jour) => total + jour.clients, 0)).toBe(7)
    expect(ventes.reduce((total, jour) => total + jour.chiffreCents, 0)).toBe(430_000)
    expect(instantane).toMatchObject({ affaires: 2, delaiMoyenJours: 10, cohortes: [{ mois: '2026-06', prospects: 55, clients: 6 }] })
    expect(JSON.stringify({ jours, ventes, instantane })).not.toMatch(/T10:00|hs_object_id/u)
  })

  it('lit un taux par cohorte et repère le canal payant qui ne signe pas', () => {
    const { instantane } = agregerCrm(contacts, affaires, 'Europe/Zurich', '2026-04-01', '2026-09-23')
    const lecture = lireCrm(instantane)!
    expect(lecture.global).toMatchObject({ prospects: 55, clients: 6 })
    expect(lecture.global!.taux).toBeCloseTo(6 / 55, 5)
    expect(canalQuiNeSignePas(lecture)).toMatchObject({ cle: 'meta-ads', clients: 0, prospects: 25 })
  })

  it('fait des prospects CRM la référence, et calcule le coût par client signé', () => {
    const { jours } = agregerCrm(contacts, affaires, 'Europe/Zurich', '2026-04-01', '2026-09-23')
    const donnees: Donnees = {
      devise: 'CHF',
      regies: ['meta-ads'],
      campagnes: [{ plateforme: 'meta-ads', campagneId: 'm', nom: 'M', jour: '2026-06-15', depense: 700, clics: 0, impressions: 0, conversions: 25, valeur: 0 }],
      ventes: { disponibles: false, couvertureDepuis: null, jours: [] },
      recherche: null,
      crm: { disponibles: true, couvertureDepuis: '2026-04-01', jours },
    }
    const bornes = { du: '2026-06-01', au: '2026-08-31' }
    expect(cumulCrm(donnees.crm, bornes)).toMatchObject({ prospects: 55, clients: 7 })
    const kpis = Object.fromEntries(indicateursNova(ensemble(donnees, bornes), ensemble(donnees, bornes)).map((kpi) => [kpi.cle, kpi]))
    expect(kpis.leads).toMatchObject({ valeur: 55, source: 'HubSpot, contacts créés' })
    expect(kpis.signes!.valeur).toBe(7)
    expect(kpis.cps!.valeur).toBe(100)
    expect(cumulCrm(donnees.crm, { du: '2026-01-01', au: '2026-08-31' })).toBeNull()
  })
})

describe('Nova V8 — âge et sexe', () => {
  const visites = (lignes: { age: string; sexe: string; sessions: number }[]) => {
    const jours = agregerVisites(
      [{ dimensions: ['20260920', 'Direct', '(direct)', '(none)', 'desktop'], metriques: [lignes.reduce((t, l) => t + l.sessions, 0), 0, 0, 0] }],
      [],
      [],
      [{ dimensions: ['20260920', 'CH', 'new'], metriques: [lignes.reduce((t, l) => t + l.sessions, 0), 0] }],
      [],
      lignes.map((ligne) => ({ dimensions: ['20260920', ligne.age, ligne.sexe], metriques: [ligne.sessions, 1] })),
    )
    return cumulVisites(
      { disponibles: true, couvertureDepuis: '2026-01-01', jours: jours.map((jour) => ({ ...jour, revenu: 0, canaux: {}, pages: [], pagesSeo: [] })) },
      { du: '2026-09-01', au: '2026-09-30' },
    )
  }

  it('montre âge et sexe quand Google les connaît pour la moitié des visites au moins', () => {
    const audiences = lireAudiences(
      visites([
        { age: '25-34', sexe: 'female', sessions: 300 },
        { age: '35-44', sexe: 'male', sessions: 200 },
        { age: 'unknown', sexe: 'unknown', sessions: 100 },
      ]),
    )
    expect(audiences!.ages!.map((un) => [un.nom, un.part])).toEqual([
      ['25-34 ans', 0.6],
      ['35-44 ans', 0.4],
    ])
    expect(audiences!.sexes!.map((un) => un.nom)).toEqual(['Femmes', 'Hommes'])
  })

  it('se tait quand la plupart des visites sont inconnues', () => {
    const audiences = lireAudiences(
      visites([
        { age: '25-34', sexe: 'female', sessions: 100 },
        { age: 'unknown', sexe: 'unknown', sessions: 500 },
      ]),
    )
    expect(audiences!.ages).toBeNull()
    expect(audiences!.sexes).toBeNull()
  })
})
