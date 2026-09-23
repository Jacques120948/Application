import { describe, expect, it } from 'vitest'
import { cohortesClients } from '@/server/nova/agregat'
import { surveillance } from '@/server/nova/surveillance'
import type { Donnees, JourCampagne, JourVentes } from '@/server/nova/metriques'
import type { CommandeShopify } from '@/server/integrations/providers/shopify'
import { novaAnalyseSchema } from '@/server/ai/schemas'
import { MINIMUM_COST } from '@/server/billing/credits'
import { MODELS, OPERATION_PROFILES } from '@/server/ai/routing'

const JOUR = 24 * 60 * 60 * 1000
const decaler = (jour: string, n: number) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * JOUR).toISOString().slice(0, 10)
const HIER = '2026-09-22'

function jourVentes(jour: string, commandes: number, chiffre: number): JourVentes {
  return { jour, commandes, chiffre, nouveauxClients: 0, chiffreNouveaux: 0, clientsIdentifies: 0, canaux: {}, canauxPremier: {}, produits: [] }
}

describe('Nova V7 — surveillance', () => {
  it('signale un coût par conversion qui dérive sur 7 jours, avec assez de volume', () => {
    const campagnes: JourCampagne[] = Array.from({ length: 90 }, (_, i) => {
      const jour = decaler(HIER, -i)
      // 100 par jour pour 2 conversions ; les 7 derniers jours, 0,8 seulement : 5,6 conversions, assez pour conclure.
      const recent = i < 7
      return { plateforme: 'google-ads', campagneId: 'c', nom: 'C', jour, depense: 100, clics: 50, impressions: 1_000, conversions: recent ? 0.8 : 2, valeur: recent ? 60 : 300 }
    })
    const donnees: Donnees = { devise: 'CHF', regies: ['google-ads'], campagnes, ventes: { disponibles: false, couvertureDepuis: null, jours: [] }, recherche: null }
    const lignes = surveillance(donnees, HIER)
    const cpa = lignes.find((ligne) => ligne.cle === 'google-ads.cpa')!
    expect(cpa.valeurs['30']).toBeGreaterThan(cpa.valeurs['90']!)
    expect(cpa.niveau).toBe('alerte')
    expect(cpa.ecart).toMatchObject({ de: '7', contre: '30' })
    // La dépense n'a pas bougé : rien à signaler.
    expect(lignes.find((ligne) => ligne.cle === 'google-ads.depense')!.niveau).toBe('normal')
  })

  it('ne conclut rien sur trop peu de conversions, et laisse vides les fenêtres non couvertes', () => {
    const campagnes: JourCampagne[] = Array.from({ length: 30 }, (_, i) => ({
      plateforme: 'meta-ads',
      campagneId: 'm',
      nom: 'M',
      jour: decaler(HIER, -i),
      depense: 10,
      clics: 5,
      impressions: 100,
      conversions: i < 7 ? 0 : 0.2,
      valeur: 0,
    }))
    const ventes = Array.from({ length: 40 }, (_, i) => jourVentes(decaler(HIER, -i), 2, 100))
    const donnees: Donnees = {
      devise: 'CHF',
      regies: ['meta-ads'],
      campagnes,
      ventes: { disponibles: true, couvertureDepuis: decaler(HIER, -39), jours: ventes },
      recherche: null,
    }
    const lignes = surveillance(donnees, HIER)
    expect(lignes.find((ligne) => ligne.cle === 'meta-ads.cpa')!.niveau).toBe('normal')
    const chiffre = lignes.find((ligne) => ligne.cle === 'ventes.chiffre')!
    expect(chiffre.valeurs).toMatchObject({ hier: 100, '7': 100, '30': 100, '90': null })
  })
})

describe('Nova V7 — cohortes de clients', () => {
  const commande = (client: string, jour: string, totalCents: number, premiere: boolean | null): CommandeShopify => ({
    id: `${client}-${jour}`,
    creeLe: `${jour}T12:00:00Z`,
    totalCents,
    devise: 'CHF',
    annulee: false,
    test: false,
    premiere,
    visite: null,
    premiereVisite: null,
    clientId: client,
    lignes: [],
  })

  it('suit les clients depuis leur première commande, et ne garde que des moyennes', () => {
    const commandes = [
      ...['a', 'b', 'c', 'd', 'e'].map((client) => commande(client, '2026-07-05', 5_000, true)),
      commande('a', '2026-08-10', 3_000, false),
      commande('b', '2026-09-02', 4_000, false),
      // Un client déjà connu avant la fenêtre ne forme pas de cohorte.
      commande('z', '2026-07-06', 9_000, false),
      // Une cohorte trop petite est écartée.
      commande('f', '2026-08-01', 5_000, true),
    ]
    const [juillet, ...autres] = cohortesClients(commandes, 'Europe/Zurich', '2026-09-23')
    expect(autres).toEqual([])
    expect(juillet).toEqual({ mois: '2026-07', clients: 5, revenus: [0, 0.2, 0.4], chiffreParClientCents: [5_000, 5_600, 6_400] })
    expect(JSON.stringify(juillet)).not.toMatch(/"a"|"b"/u)
  })
})

describe('Nova V7 — écrits et routage des modèles', () => {
  it('route la synthèse vers le modèle économique et l’analyse vers le raisonnement', () => {
    expect(OPERATION_PROFILES.novaSynthese.model).toBe(MODELS.economical)
    expect(OPERATION_PROFILES.novaAnalyse.model).toBe(MODELS.reasoning)
    expect(MINIMUM_COST.novaAnalyse).toBeGreaterThan(MINIMUM_COST.novaSynthese)
  })

  it('refuse une analyse sans priorité, ou qui confie à un agent inconnu', () => {
    const base = { diagnostic: 'Les ventes tiennent, la publicité coûte cher.', risques: [], aVerifier: [] }
    expect(novaAnalyseSchema.safeParse({ ...base, priorites: [] }).success).toBe(false)
    expect(novaAnalyseSchema.safeParse({ ...base, priorites: [{ titre: 'Baisser', pourquoi: 'Le CPA a doublé.', chiffre: 'CPA +60 %', agent: 'inconnu' }] }).success).toBe(false)
    expect(novaAnalyseSchema.safeParse({ ...base, priorites: [{ titre: 'Revoir Google', pourquoi: 'Le CPA a doublé.', chiffre: 'CPA +60 %', agent: 'ads' }] }).success).toBe(true)
  })
})
