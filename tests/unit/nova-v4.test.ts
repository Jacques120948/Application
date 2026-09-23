import { describe, expect, it } from 'vitest'
import { agregerCommandes } from '@/server/nova/agregat'
import { cumulVentes, performanceProduits, periodeDe, periodePrecedente, attribution, performanceCampagnes, type Donnees, type JourVentes } from '@/server/nova/metriques'
import { margeEstimee, COUVERTURE_COUTS_MIN } from '@/server/nova/pilotage'
import { detecterAlertes, detecterInsights, type Contexte } from '@/server/nova/analyse'
import type { CommandeShopify } from '@/server/integrations/providers/shopify'
import { controlesSuivi } from '@/server/nova/suivi'
import { questionNova, resumeContenus } from '@/server/nova/delegation'
import { contenuQualifie, contenusQuiAttirent, estArticle } from '@/server/nova/contenus'

function commande(lignes: CommandeShopify['lignes'], totalCents = 10_000): CommandeShopify {
  return {
    id: 'gid://shopify/Order/1',
    creeLe: '2026-09-20T10:00:00Z',
    totalCents,
    devise: 'CHF',
    annulee: false,
    test: false,
    premiere: null,
    visite: null,
    premiereVisite: null,
    clientId: null,
    lignes,
  }
}

function jourVentes(partiel: Partial<JourVentes> & Pick<JourVentes, 'jour'>): JourVentes {
  return { commandes: 0, chiffre: 0, nouveauxClients: 0, chiffreNouveaux: 0, clientsIdentifies: 0, canaux: {}, canauxPremier: {}, produits: [], ...partiel }
}

describe('Nova V4 — coût des produits à l’agrégation', () => {
  it('porte le coût des variantes connues, et seulement celles-là', () => {
    const couts = new Map([['v1', 1_500]])
    const [jour] = agregerCommandes(
      [
        commande([
          { produitId: 'p1', varianteId: 'v1', titre: 'Bougie', quantite: 2, totalCents: 6_000 },
          { produitId: 'p2', varianteId: 'v2', titre: 'Diffuseur', quantite: 1, totalCents: 4_000 },
        ]),
      ],
      'Europe/Zurich',
      couts,
    )
    expect(jour).toMatchObject({ coutsLus: true, lignesCents: 10_000, lignesCouteesCents: 6_000, coutProduitsCents: 3_000 })
    expect(jour!.produits.find((p) => p.id === 'p1')).toMatchObject({ coutCents: 3_000, quantiteCoutee: 2 })
    expect(jour!.produits.find((p) => p.id === 'p2')).toMatchObject({ coutCents: 0, quantiteCoutee: 0 })
  })

  it('sans coûts lus, le jour le dit au lieu de compter zéro', () => {
    const [jour] = agregerCommandes([commande([{ produitId: 'p1', varianteId: 'v1', titre: 'Bougie', quantite: 1, totalCents: 3_000 }])], 'Europe/Zurich')
    expect(jour!.coutsLus).toBe(false)
  })
})

describe('Nova V4 — marge réelle', () => {
  const bornes = { du: '2026-09-01', au: '2026-09-30' }
  const ventes = (jours: JourVentes[]) => cumulVentes({ disponibles: true, couvertureDepuis: '2026-01-01', jours }, bornes)

  it('une période dont un jour n’a pas ses coûts ne donne pas de coûts', () => {
    const cumul = ventes([
      jourVentes({ jour: '2026-09-10', commandes: 1, chiffre: 100, coutsLus: true, lignes: 90, lignesCoutees: 90, coutProduits: 30 }),
      jourVentes({ jour: '2026-09-11', commandes: 1, chiffre: 100 }),
    ])
    expect(cumul!.couts).toBeNull()
  })

  it('préfère le coût Shopify au pourcentage, et étend une couverture partielle en le disant', () => {
    const cumul = ventes([jourVentes({ jour: '2026-09-10', commandes: 10, chiffre: 1_000, coutsLus: true, lignes: 1_000, lignesCoutees: 900, coutProduits: 360 })])
    const marge = margeEstimee(cumul, 200, { coutProduitPct: 10 })
    expect(marge).toMatchObject({ etat: 'calculee', source: 'shopify' })
    if (marge.etat !== 'calculee') throw new Error()
    // 360 couvre 90 % des lignes : 400 pour l'ensemble.
    expect(marge.lignes[0]).toEqual({ quoi: 'Coût des produits', montant: 400 })
    expect(marge.note).toContain('90 %')
    // CA 1 000 − produits 400 − publicité 200.
    expect(marge.marge).toBe(400)
    // Avant publicité il reste 600 : 1 000 ÷ 600 = 167 %.
    expect(marge.merEquilibre).toBe(167)
  })

  it('retombe sur le pourcentage quand Shopify couvre trop peu', () => {
    const cumul = ventes([jourVentes({ jour: '2026-09-10', commandes: 10, chiffre: 1_000, coutsLus: true, lignes: 1_000, lignesCoutees: 500, coutProduits: 200 })])
    expect(COUVERTURE_COUTS_MIN).toBeGreaterThan(0.5)
    const marge = margeEstimee(cumul, null, { coutProduitPct: 30 })
    expect(marge).toMatchObject({ etat: 'calculee', source: 'pourcent', merEquilibre: 143 })
    expect(margeEstimee(cumul, null, {})).toMatchObject({ etat: 'impossible', raison: expect.stringContaining('50 %') })
  })

  it('donne une marge par produit seulement quand toutes ses unités ont un coût', () => {
    const cumul = ventes([
      jourVentes({
        jour: '2026-09-10',
        commandes: 3,
        chiffre: 300,
        coutsLus: true,
        lignes: 300,
        lignesCoutees: 200,
        coutProduits: 50,
        produits: [
          { id: 'p1', titre: 'Bougie', commandes: 2, quantite: 2, chiffre: 200, cout: 50, quantiteCoutee: 2 },
          { id: 'p2', titre: 'Diffuseur', commandes: 1, quantite: 1, chiffre: 100, cout: 0, quantiteCoutee: 0 },
        ],
      }),
    ])
    const lignes = performanceProduits(cumul, null)
    expect(lignes.find((l) => l.id === 'p1')).toMatchObject({ marge: 150, tauxMarge: 0.75 })
    expect(lignes.find((l) => l.id === 'p2')).toMatchObject({ marge: null, tauxMarge: null })
  })
})

describe('Nova V4 — constats de marge', () => {
  function contexte(donnees: Donnees, merEquilibre: number | null): Contexte {
    const periode = periodeDe('30', '2026-09-23')
    const avant = periodePrecedente(periode)
    const ventes = cumulVentes(donnees.ventes, periode)
    return {
      donnees,
      bornes: periode,
      avant,
      reference: { du: '2026-07-25', au: '2026-08-23' },
      jours: 30,
      ventes,
      ventesAvant: null,
      attribution: attribution(donnees, periode, ventes),
      campagnes: performanceCampagnes(donnees, periode, avant),
      produits: performanceProduits(ventes, null),
      merEquilibre,
    }
  }
  const donnees: Donnees = {
    devise: 'CHF',
    regies: ['meta-ads'],
    campagnes: [{ plateforme: 'meta-ads', campagneId: 'm', nom: 'M', jour: '2026-09-10', depense: 1_000, clics: 0, impressions: 0, conversions: 10, valeur: 2_000 }],
    ventes: {
      disponibles: true,
      couvertureDepuis: '2026-01-01',
      jours: [
        jourVentes({
          jour: '2026-09-10',
          commandes: 20,
          chiffre: 1_500,
          coutsLus: true,
          lignes: 1_500,
          lignesCoutees: 1_500,
          coutProduits: 900,
          produits: [
            { id: 'p1', titre: 'Coffret', commandes: 10, quantite: 10, chiffre: 1_000, cout: 800, quantiteCoutee: 10 },
            { id: 'p2', titre: 'Bougie', commandes: 10, quantite: 10, chiffre: 500, cout: 100, quantiteCoutee: 10 },
          ],
        }),
      ],
    },
    recherche: null,
  }

  it('signale un MER sous le seuil de rentabilité, à la régie qui dépense', () => {
    const alerte = detecterAlertes(contexte(donnees, 250)).find((a) => a.cle === 'marge.seuil')
    // MER 150 % contre un seuil de 250 % : rouge, pour MIRA.
    expect(alerte).toMatchObject({ niveau: 'rouge', agent: 'meta' })
    expect(detecterAlertes(contexte(donnees, 140)).find((a) => a.cle === 'marge.seuil')).toBeUndefined()
    expect(detecterAlertes(contexte(donnees, null)).find((a) => a.cle === 'marge.seuil')).toBeUndefined()
  })

  it('nomme le produit qui fait du chiffre sans laisser de marge', () => {
    const constat = detecterInsights(contexte(donnees, null)).find((i) => i.cle === 'marge.p1')
    expect(constat?.texte).toContain('20 %')
    expect(constat?.fondement).toContain('Estimation basée sur les coûts renseignés')
  })
})

describe('Nova V4 — qualité du suivi', () => {
  const pub = (depense: number, conversions: number) => ({ depense, clics: 0, impressions: 0, conversions, valeur: 0 })
  const base = {
    commandes: 40,
    chiffre: 4_000,
    nouveauxClients: 0,
    chiffreNouveaux: 0,
    clientsIdentifies: 0,
    canauxPremier: {},
    produits: [],
    couts: null,
  }

  it('repère des publicités Meta sans UTM, et le transmet à MIRA', () => {
    const controles = controlesSuivi({
      ventes: { ...base, canaux: { social: { commandes: 12, chiffre: 1_200, origines: { 'l.facebook.com': 8, 'instagram.com': 4 } } } },
      regies: ['meta-ads'],
      pub: () => pub(300, 10),
    })
    expect(controles).toEqual([expect.objectContaining({ cle: 'suivi.utm-meta', agent: 'meta' })])
    expect(controles[0]!.texte).toContain('12')
  })

  it('repère un Google Ads qui convertit sans qu’aucune commande lui soit attribuée', () => {
    const controles = controlesSuivi({ ventes: { ...base, canaux: { seo: { commandes: 40, chiffre: 4_000, origines: {} } } }, regies: ['google-ads'], pub: () => pub(400, 12) })
    expect(controles.map((c) => c.cle)).toEqual(['suivi.gclid'])
  })

  it('nomme les étiquettes UTM qu’aucun canal ne reconnaît, pour Léa', () => {
    const controles = controlesSuivi({
      ventes: { ...base, canaux: { autres: { commandes: 8, chiffre: 800, origines: { 'promo-hiver / banniere': 6, 'partenaire / lien': 2 } } } },
      regies: [],
      pub: () => pub(0, 0),
    })
    expect(controles).toEqual([expect.objectContaining({ cle: 'suivi.utm-inconnues', agent: 'audit' })])
    expect(controles[0]!.texte).toContain('« promo-hiver / banniere »')
  })

  it('ne conclut rien sur trop peu de commandes', () => {
    expect(controlesSuivi({ ventes: { ...base, commandes: 5, canaux: {} }, regies: ['google-ads'], pub: () => pub(400, 12) })).toEqual([])
  })

  it('demande à Léa si un audit est nécessaire, sans prétendre à une cause prouvée', () => {
    const question = questionNova({ titre: 'Suivi à vérifier — Étiquettes UTM', pourquoi: '20 % des commandes…' }, 'audit')
    expect(question).toContain('audit technique')
    expect(question).toContain('pas une cause prouvée')
  })
})

describe('Nova V4 — contenus qui attirent', () => {
  const visites = (pages: { page: string; sessions: number; achats: number; revenu: number; engagees?: number }[]) => ({
    sessions: 2_000,
    sessionsEngagees: 1_000,
    achats: 20,
    revenu: 2_000,
    canaux: {},
    appareils: {},
    pages,
    pagesSeo: [],
  })

  it('ne garde que les articles de blog, avec assez de visites', () => {
    expect(estArticle('/blogs/news/bougie-citrine')).toBe(true)
    expect(estArticle('/fr/blogs/journal/rituel-du-soir')).toBe(true)
    expect(estArticle('/blog/mon-article')).toBe(true)
    expect(estArticle('/blogs/news')).toBe(false)
    expect(estArticle('/products/bougie')).toBe(false)
    const contenus = contenusQuiAttirent(
      visites([
        { page: '/blogs/news/a', sessions: 120, achats: 2, revenu: 90, engagees: 90 },
        { page: '/blogs/news/b', sessions: 10, achats: 0, revenu: 0, engagees: 8 },
        { page: '/products/c', sessions: 500, achats: 9, revenu: 400, engagees: 300 },
      ]),
    )
    expect(contenus.lignes.map((l) => l.page)).toEqual(['/blogs/news/a'])
    expect(contenus.lignes[0]!.engagement).toBe(0.75)
    expect(contenus.engagementSite).toBe(0.5)
  })

  it('signale à Milo l’article nettement plus engagé que le site, pas un article dans la moyenne', () => {
    const fort = contenusQuiAttirent(visites([{ page: '/blogs/news/a', sessions: 120, achats: 0, revenu: 0, engagees: 90 }]))
    expect(contenuQualifie(fort)?.page).toBe('/blogs/news/a')
    const moyen = contenusQuiAttirent(visites([{ page: '/blogs/news/a', sessions: 120, achats: 0, revenu: 0, engagees: 66 }]))
    expect(contenuQualifie(moyen)).toBeNull()
    // Sans mesure d'engagement (jours lus avant la V4), rien n'est conclu.
    const inconnu = contenusQuiAttirent(visites([{ page: '/blogs/news/a', sessions: 120, achats: 0, revenu: 0 }]))
    expect(inconnu.lignes[0]!.engagement).toBeNull()
    expect(contenuQualifie(inconnu)).toBeNull()
  })

  it('résume les articles pour la question transmise à Milo', () => {
    const texte = resumeContenus(contenusQuiAttirent(visites([{ page: '/blogs/news/a', sessions: 120, achats: 2, revenu: 90, engagees: 90 }])))
    expect(texte).toContain('/blogs/news/a : 120 visites, 75 % engagées, 2 achats')
    expect(texte).toContain('Engagement moyen du site : 50 %')
  })
})
