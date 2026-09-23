import { describe, expect, it } from 'vitest'
import { agregerVisites } from '@/server/nova/agregat-ga4'
import { cumulVisites, type JourVentes, type JourVisites } from '@/server/nova/metriques'
import { cumulLeads, evenementsProspects } from '@/server/nova/leads'
import { lireAudiences, nomPays, paysQuiNAchetePas } from '@/server/nova/audiences'
import { prevoirVentes } from '@/server/nova/previsions'

const JOUR = 24 * 60 * 60 * 1000
const decaler = (jour: string, n: number) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * JOUR).toISOString().slice(0, 10)

describe('Nova V6 — lecture GA4 enrichie', () => {
  it('range les pays, les nouveaux et connus, et les événements clés par canal', () => {
    const [jour] = agregerVisites(
      [],
      [],
      [],
      [
        { dimensions: ['20260920', 'CH', 'new'], metriques: [100, 2] },
        { dimensions: ['20260920', 'CH', 'returning'], metriques: [50, 3] },
        { dimensions: ['20260920', 'FR', 'new'], metriques: [40, 0] },
        { dimensions: ['20260920', '(not set)', 'new'], metriques: [5, 0] },
      ],
      [
        { dimensions: ['20260920', 'generate_lead', 'Paid Search', 'google', 'cpc'], metriques: [4] },
        { dimensions: ['20260920', 'generate_lead', 'Organic Search', 'google', 'organic'], metriques: [2] },
        { dimensions: ['20260920', 'page_view', 'Direct', '(direct)', '(none)'], metriques: [0] },
      ],
    )
    expect(jour!.pays).toEqual({ CH: { sessions: 150, achats: 5 }, FR: { sessions: 40, achats: 0 }, ZZ: { sessions: 5, achats: 0 } })
    expect(jour!.visiteurs).toEqual({ nouveaux: { sessions: 145, achats: 2 }, connus: { sessions: 50, achats: 3 } })
    expect(jour!.evenements).toEqual({ generate_lead: { total: 6, canaux: { 'google-ads': 4, seo: 2 } } })
  })
})

function visites(jours: Partial<JourVisites>[]) {
  return cumulVisites(
    {
      disponibles: true,
      couvertureDepuis: '2026-01-01',
      jours: jours.map((jour, i) => ({
        jour: decaler('2026-09-01', i),
        sessions: 200,
        sessionsEngagees: 100,
        achats: 4,
        revenu: 0,
        canaux: {},
        appareils: {},
        pages: [],
        pagesSeo: [],
        ...jour,
      })),
    },
    { du: '2026-09-01', au: '2026-09-30' },
  )
}

describe('Nova V6 — prospects', () => {
  it('reconnaît les demandes à leur nom, jamais l’achat', () => {
    expect(evenementsProspects(undefined, ['generate_lead', 'purchase', 'contact_form_submit', 'begin_checkout', 'scroll']).noms).toEqual([
      'generate_lead',
      'contact_form_submit',
    ])
    expect(evenementsProspects(['scroll'], ['generate_lead', 'scroll'])).toEqual({ noms: ['scroll'], auto: false })
  })

  it('compte les prospects par canal, et rien quand un jour n’a pas été lu en V6', () => {
    const lu = visites([
      { pays: { CH: { sessions: 200, achats: 4 } }, evenements: { generate_lead: { total: 3, canaux: { 'google-ads': 2, seo: 1 } }, purchase: { total: 4, canaux: {} } } },
      { pays: { CH: { sessions: 200, achats: 4 } }, evenements: { generate_lead: { total: 1, canaux: { 'google-ads': 1 } } } },
    ])
    expect(cumulLeads(lu)).toMatchObject({ total: 4, parCanal: { 'google-ads': 3, seo: 1 }, evenements: ['generate_lead'], auto: true })
    const partiel = visites([{ pays: { CH: { sessions: 200, achats: 4 } } }, {}])
    expect(cumulLeads(partiel)).toBeNull()
  })
})

describe('Nova V6 — audiences', () => {
  it('nomme les pays en français et repère celui qui visite sans acheter', () => {
    expect(nomPays('CH')).toBe('Suisse')
    expect(nomPays('ZZ')).toBe('Autres pays')
    const audiences = lireAudiences(
      visites([
        {
          sessions: 1_000,
          pays: { CH: { sessions: 600, achats: 18 }, FR: { sessions: 300, achats: 2 }, BE: { sessions: 100, achats: 2 } },
          visiteurs: { nouveaux: { sessions: 700, achats: 7 }, connus: { sessions: 300, achats: 15 } },
        },
      ]),
    )
    expect(audiences!.pays.map((un) => un.cle)).toEqual(['CH', 'FR', 'BE'])
    expect(paysQuiNAchetePas(audiences!)).toMatchObject({ pays: { cle: 'FR' }, reference: { cle: 'CH' } })
    expect(audiences!.connus.conversion).toBe(0.05)
  })

  it('ne donne pas de conversion sous le volume minimal', () => {
    const audiences = lireAudiences(visites([{ sessions: 150, pays: { CH: { sessions: 120, achats: 3 }, FR: { sessions: 30, achats: 0 } } }]))
    expect(audiences!.pays.find((un) => un.cle === 'FR')!.conversion).toBeNull()
  })
})

describe('Nova V6 — prévisions', () => {
  const aujourdhui = '2026-09-23'
  // Huit semaines régulières : 100 par jour en semaine, 300 le samedi, 0 le dimanche.
  const semaine = (jour: string) => ({ 0: 0, 6: 300 })[new Date(`${jour}T00:00:00Z`).getUTCDay()] ?? 100
  const jours = (depuis: number, facteur = 1): JourVentes[] =>
    Array.from({ length: depuis }, (_, i) => decaler(aujourdhui, -depuis + i)).map((jour) => ({
      jour,
      commandes: 2,
      chiffre: semaine(jour) * facteur,
      nouveauxClients: 0,
      chiffreNouveaux: 0,
      clientsIdentifies: 0,
      canaux: {},
      canauxPremier: {},
      produits: [],
    }))

  it('refuse de prévoir sans huit semaines de ventes', () => {
    expect(prevoirVentes(jours(40), aujourdhui, decaler(aujourdhui, -40))).toBeNull()
  })

  it('suit le profil de la semaine, et sa fourchette se resserre quand les semaines se ressemblent', () => {
    const prevision = prevoirVentes(jours(60), aujourdhui, decaler(aujourdhui, -60))!
    // 30 jours à partir d'un mercredi : 4 samedis, 4 dimanches, 22 autres jours.
    expect(prevision.prochains30.chiffre).toBe(4 * 300 + 22 * 100)
    expect(prevision.prochains30.bas).toBe(prevision.prochains30.chiffre)
    expect(prevision.saisonnalite).toBeNull()
    // Septembre : 1 → 22 déjà faits, 23 → 30 prévus.
    expect(prevision.finDeMois!.aDate).toBeGreaterThan(0)
    expect(prevision.finDeMois!.chiffre).toBeGreaterThan(prevision.finDeMois!.aDate)
  })

  it('applique la saison de l’an dernier quand l’historique existe, bornée', () => {
    const historique = jours(430)
    // L'an dernier, les trente jours à venir avaient rendu trois fois plus : borné à ×2.
    for (const jour of historique) {
      if (jour.jour >= decaler(aujourdhui, -364) && jour.jour < decaler(aujourdhui, -334)) jour.chiffre *= 3
    }
    const prevision = prevoirVentes(historique, aujourdhui, historique[0]!.jour)!
    expect(prevision.saisonnalite).toBe(2)
    expect(prevision.prochains30.chiffre).toBe((4 * 300 + 22 * 100) * 2)
    expect(prevision.methode).toContain('saison')
  })
})
