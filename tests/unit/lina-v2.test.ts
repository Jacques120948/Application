import { afterEach, describe, expect, it, vi } from 'vitest'
import { telechargerCommandes, type CommandeExport } from '@/server/integrations/providers/shopify-clients'
import { analyserCommandes } from '@/server/lina/commandes'
import { CRITERES_DEFAUT } from '@/server/lina/criteres'
import { enrichir, resultatSchema, significatif, testsAB, verdictAB } from '@/server/lina/resultats'
import { appartient, contexteSegments, segmenter, type ClientIndex } from '@/server/lina/segments'
import {
  audiencesPub,
  campagnesProduits,
  programmeFidelite,
  reachatParProduit,
  risquesDepart,
  scenarios,
  suggestions,
  valeurClient,
} from '@/server/lina/valeur'
import { LINA_SYSTEM } from '@/server/ai/prompts'

const MAINTENANT = new Date('2026-09-23T12:00:00Z')
const JOUR = 24 * 60 * 60 * 1000
const ilYA = (jours: number) => new Date(+MAINTENANT - jours * JOUR).toISOString()

let n = 0
function commande(client: string | null, joursAvant: number, produits: [string, number][]): CommandeExport {
  n += 1
  return {
    id: `gid://shopify/Order/${n}`,
    creeLe: ilYA(joursAvant),
    clientRef: client,
    totalCents: produits.reduce((total, [, prix]) => total + prix, 0),
    devise: 'CHF',
    lignes: produits.map(([ref, prix]) => ({ produitRef: ref, titre: ref === '1' ? 'Bougie' : ref === '2' ? 'Recharge' : ref === '3' ? 'Grande bougie' : `P${ref}`, type: ref === '3' || ref === '1' ? 'Bougies' : 'Accessoires', quantite: 1, prixUnitaireCents: prix })),
  }
}

/** Vingt clients : bougie, puis recharge 40 jours après, puis re-bougie 60 jours après ; dix passent à la grande bougie. */
function historique(): { commandes: CommandeExport[]; connus: Map<string, number> } {
  const commandes: CommandeExport[] = []
  const connus = new Map<string, number>()
  for (let i = 0; i < 20; i++) {
    const ref = `c${i}`
    commandes.push(commande(ref, 300, [['1', 3_000]]))
    commandes.push(commande(ref, 260, [['2', 1_500]]))
    commandes.push(commande(ref, 200, [i < 10 ? ['3', 6_000] : ['1', 3_000]]))
    connus.set(ref, 3)
  }
  // Un client dont l'histoire commence avant l'export : sa première commande est inconnue.
  commandes.push(commande('ancien', 100, [['1', 3_000]]))
  connus.set('ancien', 5)
  commandes.push(commande(null, 5, [['1', 3_000]]))
  return { commandes, connus }
}

describe('Lina V2 — lecture de l’export des commandes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rattache les articles à leur commande, en flux, et écarte les annulées', async () => {
    const lignes = [
      JSON.stringify({ id: 'gid://shopify/Order/1', createdAt: '2026-01-01T10:00:00Z', cancelledAt: null, test: false, customer: { id: 'gid://shopify/Customer/7' }, currentTotalPriceSet: { shopMoney: { amount: '50.00', currencyCode: 'CHF' } } }),
      JSON.stringify({ quantity: 2, originalUnitPriceSet: { shopMoney: { amount: '25.00' } }, product: { id: 'gid://shopify/Product/9', title: 'Bougie', productType: 'Bougies' }, __parentId: 'gid://shopify/Order/1' }),
      JSON.stringify({ id: 'gid://shopify/Order/2', createdAt: '2026-01-02T10:00:00Z', cancelledAt: '2026-01-03T10:00:00Z', test: false, customer: null, currentTotalPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'CHF' } } }),
      JSON.stringify({ quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '10.00' } }, product: { id: 'gid://shopify/Product/9', title: 'Bougie' }, __parentId: 'gid://shopify/Order/2' }),
    ]
    // Découpé au milieu d'une ligne : le lecteur en flux doit recoller.
    const texte = lignes.join('\n')
    const flux = new ReadableStream({
      start(controleur) {
        controleur.enqueue(new TextEncoder().encode(texte.slice(0, 57)))
        controleur.enqueue(new TextEncoder().encode(texte.slice(57)))
        controleur.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(flux, { status: 200 })))
    const { commandes } = await telechargerCommandes('https://stockage.example/export.jsonl')
    expect(commandes).toEqual([
      { id: 'gid://shopify/Order/1', creeLe: '2026-01-01T10:00:00Z', clientRef: '7', totalCents: 5_000, devise: 'CHF', lignes: [{ produitRef: '9', titre: 'Bougie', type: 'Bougies', quantite: 2, prixUnitaireCents: 2_500 }] },
    ])
  })
})

describe('Lina V2 — ce que les commandes apprennent', () => {
  const { commandes, connus } = historique()
  const resultat = analyserCommandes(commandes, connus, { depuis: '2025-09-01', tronque: false, historiqueComplet: false, fuseau: 'Europe/Zurich', maintenant: MAINTENANT })
  const produit = (ref: string) => resultat.produits.find((un) => un.ref === ref)!

  it('connaît la vraie première commande seulement quand toute l’histoire est lue', () => {
    const c0 = resultat.parClient.find((un) => un.ref === 'c0')!
    expect(c0.premiereCommande).toBe(ilYA(300))
    expect(c0.intervalleJours).toBe(50)
    expect(resultat.parClient.find((un) => un.ref === 'ancien')!.premiereCommande).toBeNull()
  })

  it('mesure le rythme de réachat par produit', () => {
    expect(produit('1')).toMatchObject({ acheteurs: 21, reacheteurs: 10, intervalleMedian: 100 })
    const reachat = reachatParProduit(resultat.produits)
    expect(reachat[0]).toMatchObject({ ref: '1', p25: 100, p75: 100 })
    expect(reachat[0]!.texte).toContain('entre 100 et 100 jours')
  })

  it('trouve ce qui est acheté ensuite, et la montée en gamme', () => {
    const recharge = resultat.analyse.suivants.find((paire) => paire.de === '1' && paire.vers === '2')!
    expect(recharge.clients).toBe(20)
    expect(recharge.part).toBeCloseTo(20 / 21, 5)
    expect(resultat.analyse.montees.map((paire) => `${paire.de}>${paire.vers}`)).toEqual(['1>3'])
    const croisees = suggestions(resultat.analyse.suivants, resultat.produits, resultat.analyse.ensemble, false)
    expect(croisees[0]!.requeteShopify).toBe('products_purchased MATCHES (id = 1) AND products_purchased NOT MATCHES (id = 2)')
  })

  it('mesure le délai de la deuxième commande et construit les cohortes', () => {
    expect(resultat.analyse.reachat.medianeJours).toBe(40)
    expect(resultat.analyse.reachat.sous.find((un) => un.jours === 60)!.part).toBe(1)
    expect(resultat.analyse.cohortes.map((cohorte) => cohorte.clients)).toEqual([20])
  })

  it('propose des campagnes de réachat et de produit complémentaire avec la requête Shopify', () => {
    const liste = campagnesProduits(
      reachatParProduit(resultat.produits),
      suggestions(resultat.analyse.suivants, resultat.produits, resultat.analyse.ensemble, false),
      suggestions(resultat.analyse.montees, resultat.produits, resultat.analyse.ensemble, true),
      resultat.produits,
      'CHF',
    )
    const reachat = liste.find((campagne) => campagne.cle === 'reachat-1')!
    expect(reachat.requeteShopify).toBe("products_purchased MATCHES (id = 1, date BETWEEN -100d AND -100d) AND email_subscription_status = 'SUBSCRIBED'")
    expect(reachat.remise).toContain('Pas de remise')
    expect(liste.some((campagne) => campagne.cle === 'upsell-1-3')).toBe(true)
    expect(liste.every((campagne) => campagne.hypothese.includes('pas une prévision'))).toBe(true)
  })
})

describe('Lina V2 — valeur, risque, fidélité, audiences, scénarios', () => {
  const client = (i: number, partiel: Partial<ClientIndex>): ClientIndex => ({
    ref: String(i),
    creeLe: new Date(ilYA(700)),
    derniereCommande: new Date(ilYA(30)),
    commandes: 4,
    caCents: 40_000,
    consentement: 'oui',
    ...partiel,
  })
  const base = [
    ...Array.from({ length: 60 }, (_, i) => client(i, { premiereCommande: new Date(ilYA(730)) })),
    ...Array.from({ length: 40 }, (_, i) => client(100 + i, { premiereCommande: new Date(ilYA(730)), derniereCommande: new Date(ilYA(500)), commandes: 1, caCents: 10_000 })),
  ]

  it('distingue la valeur observée de la valeur estimée, avec sa méthode', () => {
    const v = valeurClient(base, MAINTENANT)
    expect(v.observeeCents).toBe(Math.round((60 * 40_000 + 40 * 10_000) / 100))
    expect(v.attritionAnnuelle).toBeCloseTo(0.4, 5)
    expect(v.dureeVieAns).toBe(2.5)
    expect(v.estimeeCents).not.toBeNull()
    expect(v.methode).toContain('Estimée')
    expect(valeurClient(base.slice(0, 30), MAINTENANT).estimeeCents).toBeNull()
  })

  it('classe le risque de départ selon le rythme propre à chaque client', () => {
    const contexte = contexteSegments(base, CRITERES_DEFAUT, MAINTENANT)
    const reguliers = [
      client(900, { intervalleJours: 20, derniereCommande: new Date(ilYA(70)) }),
      client(901, { intervalleJours: 30, derniereCommande: new Date(ilYA(70)) }),
    ]
    expect(appartient(reguliers[0]!, 'a-risque', contexte)).toBe(true)
    const risques = risquesDepart(reguliers, contexte)
    expect(risques.find((r) => r.niveau === 'eleve')!.clients).toBe(1)
    expect(risques.find((r) => r.niveau === 'moyen')!.clients).toBe(1)
  })

  it('propose des paliers, des audiences assez grandes et des scénarios préparés', () => {
    const contexte = contexteSegments(base, CRITERES_DEFAUT, MAINTENANT)
    const segments = segmenter(base, contexte, true, 'CHF')
    const paliers = programmeFidelite(segments, base, CRITERES_DEFAUT)
    expect(paliers.find((p) => p.cle === 'fidele')!.clients).toBe(60)
    expect(paliers.every((p) => !/remise de|\d+ %/u.test(p.avantage))).toBe(true)
    expect(audiencesPub(segments).every((a) => a.clients >= 100 || a.cle === 'exclusion')).toBe(true)
    const liste = scenarios(segments, [], 12, CRITERES_DEFAUT)
    expect(liste.find((s) => s.cle === 'panier')!.concernes).toBe(12)
    expect(liste.every((s) => s.ou !== '')).toBe(true)
  })
})

describe('Lina V2 — résultats et tests A/B', () => {
  const r = (envoyes: number, conversions: number, extra: Partial<Parameters<typeof enrichir>[1]> = {}) =>
    enrichir('x', resultatSchema.parse({ nom: 'Test', envoyes, conversions, caCents: conversions * 5_000, ...extra }))

  it('calcule les taux et le revenu par destinataire', () => {
    const un = r(1_000, 20, { ouvertures: 400, clics: 80, desinscriptions: 5 })
    expect(un).toMatchObject({ tauxOuverture: 0.4, tauxClic: 0.08, tauxConversion: 0.02, revenuParDestinataireCents: 100, tauxDesinscription: 0.005 })
  })

  it('refuse des chiffres impossibles', () => {
    expect(resultatSchema.safeParse({ nom: 'x', envoyes: 10, conversions: 20, caCents: 0 }).success).toBe(false)
    expect(resultatSchema.safeParse({ nom: 'x', envoyes: 10, conversions: 1, caCents: 0, variante: 'A' }).success).toBe(false)
  })

  it('ne déclare un gagnant qu’avec assez de données et un écart significatif', () => {
    expect(verdictAB('t', r(50, 5), r(50, 10)).gagnant).toBeNull()
    expect(verdictAB('t', r(1_000, 20), r(1_000, 24)).gagnant).toBeNull()
    const net = verdictAB('t', r(2_000, 20), r(2_000, 60))
    expect(net.gagnant).toBe('B')
    expect(net.explication).toContain('95 %')
    expect(significatif(20, 2_000, 60, 2_000).significatif).toBe(true)
  })

  it('reconnaît les tests : même groupe, variantes A et B', () => {
    const a = { ...r(2_000, 20), groupe: 'objet', variante: 'A' as const }
    const b = { ...r(2_000, 60), groupe: 'objet', variante: 'B' as const }
    const seul = { ...r(500, 5), groupe: 'autre', variante: 'A' as const }
    expect(testsAB([a, b, seul]).map((test) => test.groupe)).toEqual(['objet'])
  })

  it('a des règles pour l’observé et l’estimé', () => {
    expect(LINA_SYSTEM).toMatch(/Observé ou estimé/u)
    expect(LINA_SYSTEM).toMatch(/pas encore de gagnant/u)
  })
})
