import { afterEach, describe, expect, it, vi } from 'vitest'
import { lireBrevo, lireKlaviyo, lireMailchimp, verifyBrevoKey, verifyKlaviyoKey, verifyMailchimpKey } from '@/server/integrations/providers/emailing'
import { lireObjectifs, objectifsLinaSchema, progression, OBJECTIFS_VIDES } from '@/server/lina/objectifs'
import { alertesLina, bilanSemaine, construireReleve, lundiDe, releveAvant, scoreFidelite, type Releve, type ReleveDate } from '@/server/lina/releves'
import { pistesServices } from '@/server/lina/services'
import { analyserCommandes } from '@/server/lina/commandes'
import type { PaniersLina } from '@/server/lina/collecte'
import type { IndicateursAbonnements } from '@/server/nova/abonnements'

/**
 * Lina V3 : outils d'envoi (lecture seule), relevés hebdomadaires, bilan, alertes, score de
 * fidélité, objectifs, pistes services / SaaS. Tout est pur, sauf les connecteurs, dont
 * `fetch` est simulé.
 */

function releve(partiel: Partial<Releve> = {}): Releve {
  return {
    au: '2026-09-23T08:00:00.000Z',
    acheteurs: 200,
    actifs: 80,
    nouveaux: 10,
    recurrents: 60,
    fideles: 30,
    tauxReachat: 0.3,
    panierMoyenCents: 6000,
    caRecurrentsCents: 900_000,
    partCaRecurrents: 0.6,
    aReactiver: 40,
    dormants: 50,
    aRisque: 12,
    vip: 10,
    vipInactifs: 2,
    paniers: { nombre: 40, recuperes: 4, valeurRecupereeCents: 24_000 },
    reactives30: 5,
    caExistants30Cents: 300_000,
    score: 70,
    ...partiel,
  }
}

const date = (semaine: string, partiel: Partial<Releve> = {}): ReleveDate => ({ ...releve(partiel), semaine })

function paniers(courant: number, precedent: number): PaniersLina {
  const periode = (nombre: number) => ({ nombre, valeurCents: nombre * 5000, recuperes: 0, valeurRecupereeCents: 0 })
  return { au: '2026-09-23T00:00:00.000Z', jours: 30, devise: 'CHF', courant: periode(courant), precedent: periode(precedent), tronque: false }
}

describe('lundiDe', () => {
  it('ramène chaque jour au lundi de sa semaine', () => {
    expect(lundiDe(new Date('2026-09-23T10:00:00Z'))).toBe('2026-09-21') // mercredi
    expect(lundiDe(new Date('2026-09-21T00:00:00Z'))).toBe('2026-09-21') // lundi
    expect(lundiDe(new Date('2026-09-27T23:59:00Z'))).toBe('2026-09-21') // dimanche
  })
})

describe('score de fidélité', () => {
  it('ne se calcule pas sous 20 acheteurs', () => {
    expect(scoreFidelite(releve({ acheteurs: 19 }))).toBeNull()
  })

  it('atteint 100 quand chaque repère est atteint', () => {
    const score = scoreFidelite(
      releve({ acheteurs: 100, tauxReachat: 0.5, actifs: 50, fideles: 20, partCaRecurrents: 0.7, dormants: 0, paniers: { nombre: 20, recuperes: 5, valeurRecupereeCents: 0 } }),
    )
    expect(score?.score).toBe(100)
    expect(score?.composantes).toHaveLength(6)
  })

  it('répartit les points des paniers quand ils ne sont pas lus', () => {
    const avec = scoreFidelite(releve({ paniers: { nombre: 40, recuperes: 0, valeurRecupereeCents: 0 } }))!
    const sans = scoreFidelite(releve({ paniers: null }))!
    expect(sans.composantes.map((un) => un.cle)).not.toContain('paniers')
    expect(sans.score).toBeGreaterThan(avec.score)
    expect(sans.note).toMatch(/Paniers non comptés/u)
  })

  it('se présente comme un indicateur interne, pas une norme', () => {
    expect(scoreFidelite(releve())!.note).toMatch(/interne/u)
    expect(scoreFidelite(releve())!.note).toMatch(/pas des normes du marché/u)
  })
})

describe('relevé de la semaine', () => {
  it('reprend les indicateurs, les segments et les commandes récentes', () => {
    const segments = [
      { cle: 'fideles', nombre: 30 },
      { cle: 'a-risque', nombre: 12 },
      { cle: 'vip', nombre: 10 },
    ] as never
    const r = construireReleve({
      indicateurs: {
        acheteurs: 200,
        actifs: 80,
        nouveaux: 10,
        recurrents: 60,
        tauxReachat: 0.3,
        panierMoyenCents: 6000,
        aReactiver: 40,
        dormants: 50,
        caTotalCents: 1_500_000,
        caRecurrentsCents: 900_000,
        partCaRecurrents: 0.6,
        sansCommande: 0,
        contactables: null,
        sansEmail: null,
      },
      segments,
      vipInactifs: 3,
      paniers: paniers(40, 30),
      recents: { reactives7: 1, reactives30: 5, caExistants30Cents: 300_000, caNouveaux30Cents: 100_000, seuilReactivation: 90 },
      maintenant: new Date('2026-09-23T08:00:00Z'),
    })
    expect(r).toMatchObject({ fideles: 30, aRisque: 12, vip: 10, vipInactifs: 3, reactives30: 5, caExistants30Cents: 300_000 })
    expect(r.paniers?.nombre).toBe(40)
    expect(r.score).not.toBeNull()
  })

  it('choisit le relevé le plus récent assez ancien', () => {
    const releves = [date('2026-09-14'), date('2026-08-24'), date('2026-08-17')]
    expect(releveAvant(releves, '2026-09-21', 1)?.semaine).toBe('2026-09-14')
    expect(releveAvant(releves, '2026-09-21', 4)?.semaine).toBe('2026-08-24')
    expect(releveAvant(releves, '2026-09-21', 10)).toBeNull()
  })
})

describe('bilan de la semaine', () => {
  const base = { semaine: '2026-09-21', nouveaux7: 8, nouveauxAvant7: 4, reactives7: 2, campagnes: [], quickWins: [{ texte: 'Relancer les paniers.' }], topSegment: null, devise: 'CHF' }

  it('ne compare rien la première semaine', () => {
    const bilan = bilanSemaine({ ...base, actuel: releve(), avant: null })
    expect(bilan.compareA).toBeNull()
    expect(bilan.baisse).toEqual([])
    // Les nouveaux clients se comparent aux sept jours d'avant, même sans relevé.
    expect(bilan.progresse).toHaveLength(1)
    expect(bilan.aFaire).toEqual(['Relancer les paniers.'])
  })

  it('range les évolutions selon leur sens, dormants compris', () => {
    const bilan = bilanSemaine({ ...base, actuel: releve({ tauxReachat: 0.32, dormants: 60 }), avant: date('2026-09-14', { tauxReachat: 0.3, dormants: 50 }) })
    const reachat = bilan.lignes.find((ligne) => ligne.cle === 'reachat')!
    expect(reachat.sens).toBe('mieux')
    expect(reachat.evolution).toMatch(/\+2 pt/u)
    expect(bilan.lignes.find((ligne) => ligne.cle === 'dormants')!.sens).toBe('moins-bien')
    expect(bilan.baisse.some((phrase) => phrase.startsWith('Clients dormants'))).toBe(true)
  })

  it('dit « non mesuré » sans commandes lues', () => {
    const bilan = bilanSemaine({ ...base, actuel: releve({ caExistants30Cents: null }), avant: null, reactives7: null })
    expect(bilan.lignes.find((ligne) => ligne.cle === 'ca-existants')!.valeur).toBe('non mesuré')
  })
})

describe('alertes', () => {
  const entree = { semaine: '2026-09-21', paniers: null, actifJours: 90 }

  it('signale une baisse du réachat d’au moins un point sur quatre semaines', () => {
    const alertes = alertesLina({ ...entree, actuel: releve({ tauxReachat: 0.28 }), releves: [date('2026-08-24', { tauxReachat: 0.3 })] })
    expect(alertes.map((un) => un.cle)).toEqual(['reachat-baisse'])
  })

  it('ne dit rien sans relevé assez ancien', () => {
    expect(alertesLina({ ...entree, actuel: releve({ tauxReachat: 0.1 }), releves: [date('2026-09-14', { tauxReachat: 0.3 })] })).toEqual([])
  })

  it('signale les VIP qui deviennent inactifs, puis ceux qui reviennent', () => {
    expect(alertesLina({ ...entree, actuel: releve({ vipInactifs: 6 }), releves: [date('2026-09-14', { vipInactifs: 4 })] })[0]?.cle).toBe('vip-inactifs')
    expect(alertesLina({ ...entree, actuel: releve({ vipInactifs: 6 }), releves: [date('2026-09-14', { vipInactifs: 6 })] })).toEqual([])
    expect(alertesLina({ ...entree, actuel: releve({ vipInactifs: 1 }), releves: [date('2026-09-14', { vipInactifs: 4 })] })[0]?.niveau).toBe('positif')
  })

  it('signale la hausse des paniers abandonnés au-delà de 25 %', () => {
    expect(alertesLina({ ...entree, actuel: releve(), releves: [], paniers: paniers(30, 20) })[0]?.cle).toBe('paniers-hausse')
    expect(alertesLina({ ...entree, actuel: releve(), releves: [], paniers: paniers(24, 20) })).toEqual([])
    expect(alertesLina({ ...entree, actuel: releve(), releves: [], paniers: paniers(15, 5) })).toEqual([])
  })

  it('garde trois alertes au plus, les baisses d’abord', () => {
    const alertes = alertesLina({
      ...entree,
      actuel: releve({ tauxReachat: 0.4, vipInactifs: 8, aRisque: 20 }),
      releves: [date('2026-09-14', { vipInactifs: 5, aRisque: 12 }), date('2026-08-24', { tauxReachat: 0.3 })],
      paniers: paniers(40, 20),
    })
    expect(alertes).toHaveLength(3)
    expect(alertes.every((un) => un.niveau === 'attention')).toBe(true)
    expect(alertes.map((un) => un.cle)).toEqual(['vip-inactifs', 'paniers-hausse', 'a-risque-hausse'])
  })
})

describe('objectifs CRM', () => {
  it('refuse une cible hors bornes et relit une valeur abîmée comme vide', () => {
    expect(objectifsLinaSchema.safeParse({ tauxReachat: 150 }).success).toBe(false)
    expect(objectifsLinaSchema.safeParse({ inconnu: 1 }).success).toBe(false)
    expect(lireObjectifs({ tauxReachat: 'beaucoup' })).toEqual(OBJECTIFS_VIDES)
    expect(lireObjectifs(null)).toEqual(OBJECTIFS_VIDES)
  })

  it('n’affiche que les objectifs fixés, avec leur avancement', () => {
    const lignes = progression({ ...OBJECTIFS_VIDES, tauxReachat: 40, reactives30: 5 }, releve({ tauxReachat: 0.3, reactives30: 6 }), 'CHF')
    expect(lignes.map((un) => un.cle)).toEqual(['tauxReachat', 'reactives30'])
    expect(lignes[0]!.part).toBeCloseTo(0.75)
    expect(lignes[0]!.atteint).toBe(false)
    expect(lignes[1]!.atteint).toBe(true)
  })

  it('dit « non mesuré » plutôt que zéro', () => {
    const [ligne] = progression({ ...OBJECTIFS_VIDES, caExistants30: 5000 }, releve({ caExistants30Cents: null }), 'CHF')
    expect(ligne!.actuel).toBeNull()
    expect(ligne!.part).toBeNull()
  })
})

describe('services et SaaS', () => {
  const abonnements: IndicateursAbonnements = {
    mrr: 5000,
    arr: 60000,
    actifs: 100,
    arpu: 50,
    churn: 0.05,
    churnMrr: 0.04,
    croissance: 2,
    ltv: 1000,
    raisonLtv: null,
    mrrNouveauMois: 300,
    mrrPerduMois: 200,
  }

  it('propose de relancer les prospects non signés et de prévenir le churn', () => {
    const pistes = pistesServices(
      'saas',
      { global: { cle: 'global', nom: 'g', prospects: 120, clients: 18, taux: 0.15 }, cohortes: [], parCanal: [], delaiMoyenJours: 21, affaires: 30 },
      { indicateurs: abonnements, devise: 'CHF' },
    )
    expect(pistes.map((un) => un.cle)).toEqual(['prospects-non-signes', 'churn-abonnes'])
    expect(pistes[0]!.constat).toMatch(/102 prospects/u)
    expect(pistes[1]!.titre).toBe('Prévenir les départs d’abonnés')
    expect(pistes[1]!.constat).toMatch(/environ 5 départs/u)
  })

  it('ne dit rien sans assez de données', () => {
    expect(pistesServices('services', { global: { cle: 'g', nom: 'g', prospects: 10, clients: 2, taux: null }, cohortes: [], parCanal: [], delaiMoyenJours: null, affaires: 0 }, null)).toEqual([])
    expect(
      pistesServices('services', { global: { cle: 'g', nom: 'g', prospects: 50, clients: 10, taux: 0.2 }, cohortes: [], parCanal: [], delaiMoyenJours: null, affaires: 0 }, null).map((un) => un.cle),
    ).toEqual(['prospects-non-signes', 'recommandation'])
    expect(pistesServices('saas', null, { indicateurs: { ...abonnements, actifs: 10 }, devise: 'CHF' })).toEqual([])
  })
})

describe('commandes récentes', () => {
  it('compte les réactivations et sépare le CA des clients existants', () => {
    const commande = (id: string, client: string, jour: string, total: number) => ({
      id,
      creeLe: `${jour}T10:00:00Z`,
      clientRef: client,
      totalCents: total,
      devise: 'CHF',
      lignes: [{ produitRef: 'p1', titre: 'Produit', type: '', quantite: 1, prixUnitaireCents: total }],
    })
    const { analyse } = analyserCommandes(
      [
        commande('1', 'a', '2026-01-10', 5000),
        commande('2', 'a', '2026-09-20', 7000), // revenu après 253 jours : réactivé
        commande('3', 'b', '2026-09-01', 3000), // nouveau
        commande('4', 'c', '2026-08-01', 2000),
        commande('5', 'c', '2026-09-05', 2500), // 35 jours : pas une réactivation
      ],
      new Map(),
      { maintenant: new Date('2026-09-23T12:00:00Z'), depuis: '2026-01-01', tronque: false, historiqueComplet: true, fuseau: 'Europe/Zurich', seuilReactivation: 90 },
    )
    expect(analyse.recents).toEqual({ reactives7: 1, reactives30: 1, caExistants30Cents: 9500, caNouveaux30Cents: 3000, seuilReactivation: 90 })
  })
})

describe('outils d’envoi', () => {
  afterEach(() => vi.unstubAllGlobals())

  const repondre = (reponses: Record<string, unknown>) =>
    vi.fn(async (url: string) => {
      const cle = Object.keys(reponses).find((motif) => url.includes(motif))
      return new Response(JSON.stringify(cle === undefined ? {} : reponses[cle]), { status: cle === undefined ? 404 : 200 })
    })

  it('vérifie la forme des clés avant tout appel', async () => {
    const appel = vi.fn()
    vi.stubGlobal('fetch', appel)
    expect((await verifyKlaviyoKey('sk_abc')).ok).toBe(false)
    expect((await verifyBrevoKey('abc')).ok).toBe(false)
    expect((await verifyMailchimpKey('abc-us1x')).ok).toBe(false)
    expect(appel).not.toHaveBeenCalled()
  })

  it('Brevo : envois, ouvertures, clics ; ni commandes ni CA', async () => {
    vi.stubGlobal(
      'fetch',
      repondre({
        emailCampaigns: {
          campaigns: [
            { id: 7, name: 'Septembre', sentDate: '2026-09-10T08:00:00Z', statistics: { globalStats: { sent: 500, uniqueViews: 200, uniqueClicks: 40, unsubscriptions: 3 } } },
            { id: 8, name: 'Vide', statistics: { globalStats: { sent: 0 } } },
          ],
        },
      }),
    )
    const lecture = await lireBrevo('cle')
    expect(lecture).toEqual({
      ok: true,
      campagnes: [{ ref: '7', nom: 'Septembre', envoyeLe: '2026-09-10', envoyes: 500, ouvertures: 200, clics: 40, conversions: null, caCents: null, desinscriptions: 3 }],
    })
  })

  it('Mailchimp : le bloc e-commerce absent reste inconnu', async () => {
    const appel = repondre({
      reports: {
        reports: [
          { id: 'a1', campaign_title: 'Avec boutique', send_time: '2026-09-01T08:00:00Z', emails_sent: 300, unsubscribed: 1, opens: { unique_opens: 120 }, clicks: { unique_subscriber_clicks: 20 }, ecommerce: { total_orders: 4, total_revenue: 250.5 } },
          { id: 'a2', campaign_title: 'Sans boutique', emails_sent: 100, opens: { unique_opens: 30 }, clicks: { unique_subscriber_clicks: 5 } },
        ],
      },
    })
    vi.stubGlobal('fetch', appel)
    const cle = `${'0123456789abcdef'.repeat(2)}-us21`
    const lecture = await lireMailchimp(cle)
    expect(String(appel.mock.calls[0]![0])).toContain('https://us21.api.mailchimp.com/3.0/reports')
    expect(lecture.ok && lecture.campagnes.map((un) => [un.conversions, un.caCents])).toEqual([
      [4, 25050],
      [null, null],
    ])
  })

  it('Klaviyo : additionne les messages d’une campagne et ignore les brouillons', async () => {
    vi.stubGlobal(
      'fetch',
      repondre({
        '/campaigns?': {
          data: [
            { id: 'c1', attributes: { name: 'Envoyée', status: 'Sent', send_time: '2026-09-12T09:00:00Z' } },
            { id: 'c2', attributes: { name: 'Brouillon', status: 'Draft' } },
          ],
        },
        '/metrics': { data: [{ id: 'm1', attributes: { name: 'Placed Order' } }] },
        'campaign-values-reports': {
          data: {
            attributes: {
              results: [
                { groupings: { campaign_id: 'c1' }, statistics: { recipients: 100, opens_unique: 40, clicks_unique: 10, unsubscribes: 1, conversions: 2, conversion_value: 80 } },
                { groupings: { campaign_id: 'c1' }, statistics: { recipients: 50, opens_unique: 20, clicks_unique: 5, unsubscribes: 0, conversions: 1, conversion_value: 40 } },
              ],
            },
          },
        },
      }),
    )
    const lecture = await lireKlaviyo('cle')
    expect(lecture).toEqual({
      ok: true,
      campagnes: [{ ref: 'c1', nom: 'Envoyée', envoyeLe: '2026-09-12', envoyes: 150, ouvertures: 60, clics: 15, conversions: 3, caCents: 12000, desinscriptions: 1 }],
    })
  })

  it('traduit un refus en phrase, sans la clé', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const lecture = await lireBrevo('xkeysib-secret')
    expect(lecture.ok).toBe(false)
    expect(!lecture.ok && lecture.raison).not.toContain('secret')
  })
})
