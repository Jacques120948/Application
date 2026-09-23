import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { findProvider } from '@/server/integrations/catalog'
import { storeConnection } from '@/server/integrations/service'
import * as emailing from '@/server/integrations/providers/emailing'
import { lireEtatEmailing, synchroniserEmailing } from '@/server/lina/emailing'
import { classerResultat, lireResultats, testsAB } from '@/server/lina/resultats'
import { enregistrerObjectifs, objectifsLina } from '@/server/lina/objectifs'
import { lireReleves, lundiDe } from '@/server/lina/releves'
import { lireLina } from '@/server/lina/service'
import { faitsLina } from '@/server/lina/contexte'
import { depuisLina } from '@/server/oria/signaux'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Lina V3 sur une vraie base : les résultats relus depuis l'outil d'envoi ne se dédoublent
 * pas, un relevé par semaine s'écrit, les alertes comparent aux relevés passés, et rien de
 * tout cela ne se voit chez quelqu'un d'autre.
 */

vi.mock('@/server/integrations/providers/emailing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/integrations/providers/emailing')>()),
  lireOutil: vi.fn(),
}))

const JOUR = 24 * 60 * 60 * 1000
const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR)
let boutique: string
let voisin: string

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

const campagne = (ref: string, nom: string, envoyes: number, clics: number): emailing.CampagneEmail => ({
  ref,
  nom,
  envoyeLe: '2026-09-10',
  envoyes,
  ouvertures: Math.round(envoyes / 3),
  clics,
  conversions: null,
  caCents: null,
  desinscriptions: 1,
})

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  boutique = await creer()
  voisin = await creer()
  await storeConnection(boutique, findProvider('shopify')!, {
    kind: 'API_KEY',
    secret: JSON.stringify({ boutique: 'lina-v3.myshopify.com', clientId: 'identifiant', clientSecret: 'secret-de-test' }),
    accountLabel: 'lina-v3.myshopify.com',
  })
  await storeConnection(boutique, findProvider('brevo')!, { kind: 'API_KEY', secret: ['xkeysib', 'test', 'factice', '0000000000000000'].join('-'), accountLabel: 'Brevo' })
  // Un index de 100 acheteurs : 30 ont recommandé, 10 VIP dont 6 silencieux depuis 200 jours.
  await withUserScope(boutique, async (tx) => {
    await tx.linaSynchro.create({ data: { userId: boutique, etat: 'ok', synchroAt: new Date(), clients: 100, consentement: true } })
    await tx.linaClient.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        userId: boutique,
        source: 'shopify',
        ref: String(20_000 + i),
        creeLe: ilYA(400),
        derniereCommande: ilYA(i < 6 ? 200 : i < 50 ? 30 : 250),
        commandes: i < 30 ? 3 : 1,
        caCents: i < 10 ? 50_000 : i < 30 ? 9_000 : 3_000,
        devise: 'CHF',
        consentement: 'oui',
      })),
    })
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [boutique, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Lina V3 — résultats relus dans l’outil d’envoi', () => {
  it('importe les campagnes, puis les met à jour sans les dédoubler', async () => {
    vi.mocked(emailing.lireOutil).mockResolvedValueOnce({ ok: true, campagnes: [campagne('7', 'Objet A', 500, 20), campagne('8', 'Objet B', 500, 45)] })
    const etat = await synchroniserEmailing(boutique, 'manuel', new Date(Date.now() - 10 * 60_000))
    expect(etat).toMatchObject({ outil: 'brevo', nom: 'Brevo', message: '' })
    expect(vi.mocked(emailing.lireOutil).mock.calls.at(-1)![0]).toBe('brevo')

    vi.mocked(emailing.lireOutil).mockResolvedValueOnce({ ok: true, campagnes: [campagne('7', 'Objet A', 520, 22), campagne('8', 'Objet B', 500, 45)] })
    await synchroniserEmailing(boutique, 'manuel')
    const resultats = await lireResultats(boutique)
    expect(resultats).toHaveLength(2)
    expect(resultats.find((r) => r.nom === 'Objet A')).toMatchObject({ source: 'brevo', envoyes: 520, conversions: null, caCents: null, tauxConversion: null })
  })

  it('attend deux minutes entre deux lectures manuelles', async () => {
    const avant = vi.mocked(emailing.lireOutil).mock.calls.length
    await synchroniserEmailing(boutique, 'manuel')
    expect(vi.mocked(emailing.lireOutil).mock.calls.length).toBe(avant)
  })

  it('se classe en test A/B, jugé sur les clics faute de commandes', async () => {
    const resultats = await lireResultats(boutique)
    for (const r of resultats) await classerResultat(boutique, { id: r.id, groupe: 'objet', variante: r.nom === 'Objet A' ? 'A' : 'B', type: 'reactivation' })
    const [test] = testsAB(await lireResultats(boutique))
    expect(test).toMatchObject({ groupe: 'objet', critere: 'clics', gagnant: 'B' })
    await expect(classerResultat(voisin, { id: resultats[0]!.id, groupe: '', variante: '', type: 'autre' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('note un refus de l’outil sans perdre les résultats', async () => {
    vi.mocked(emailing.lireOutil).mockResolvedValueOnce({ ok: false, raison: 'Brevo refuse cette clé.' })
    const etat = await synchroniserEmailing(boutique, 'manuel', new Date(Date.now() + 10 * 60_000))
    expect(etat?.message).toBe('Brevo refuse cette clé.')
    expect(await lireResultats(boutique)).toHaveLength(2)
    expect(await lireEtatEmailing(voisin)).toBeNull()
  })
})

describe('Lina V3 — relevés, bilan, alertes, objectifs', () => {
  it('écrit un relevé par semaine et le réécrit dans la semaine', async () => {
    // Il y a cinq semaines, le réachat était plus haut et moins de VIP étaient silencieux.
    const ancienne = new Date(`${lundiDe(ilYA(35))}T00:00:00Z`)
    await withUserScope(boutique, (tx) =>
      tx.linaReleve.create({
        data: {
          userId: boutique,
          semaine: ancienne,
          donnees: {
            au: ancienne.toISOString(), acheteurs: 100, actifs: 50, nouveaux: 0, recurrents: 35, fideles: 20, tauxReachat: 0.35, panierMoyenCents: 5000,
            caRecurrentsCents: 700_000, partCaRecurrents: 0.7, aReactiver: 0, dormants: 40, aRisque: 0, vip: 5, vipInactifs: 2,
            paniers: null, reactives30: null, caExistants30Cents: null, score: 60,
          },
        },
      }),
    )
    const vue = await lireLina(boutique, { avecNova: false })
    await lireLina(boutique, { avecNova: false })
    const releves = await lireReleves(boutique)
    expect(releves).toHaveLength(2)
    expect(releves[0]!.semaine).toBe(lundiDe(new Date()))
    expect(vue.releve).toMatchObject({ acheteurs: 100, recurrents: 30, vipInactifs: 6 })
    expect(vue.bilan?.compareA).toBe(lundiDe(ilYA(35)))
    expect(vue.bilan?.lignes.find((ligne) => ligne.cle === 'reachat')?.sens).toBe('moins-bien')
    expect(vue.alertes.map((alerte) => alerte.cle)).toContain('reachat-baisse')
    expect(vue.score?.score).toBeGreaterThan(0)
    expect(JSON.stringify(releves)).not.toMatch(/200\d\d/u)
  })

  it('suit les objectifs fixés par la personne', async () => {
    expect((await objectifsLina(boutique)).tauxReachat).toBeNull()
    await enregistrerObjectifs(boutique, { tauxReachat: 40, caExistants30: null, reactives30: null, valeurClient: null, score: 80 })
    const vue = await lireLina(boutique, { avecNova: false })
    expect(vue.progression.map((un) => un.cle)).toEqual(['tauxReachat', 'score'])
    expect(vue.progression[0]).toMatchObject({ cible: '40 %', actuel: '30 %', atteint: false })
    // Les seuils des segments ne sont pas touchés.
    expect(vue.criteres.actifJours).toBe(90)
  })

  it('transmet les alertes à Oria et au chat, sans aucun client', async () => {
    const vue = await lireLina(boutique, { avecNova: false })
    const signaux = depuisLina(vue, 'fr', '')
    expect(signaux.some((signal) => signal.cle === 'lina:alerte:reachat-baisse' && signal.urgence === 'important')).toBe(true)
    const faits = faitsLina(vue).join('\n')
    expect(faits).toContain('Bilan de la semaine')
    expect(faits).toContain('Score de fidélité')
    expect(faits).toContain('Objectifs CRM')
    expect(faits).not.toMatch(/200\d\d/u)
  })

  it('ne montre à personne les relevés d’un autre', async () => {
    expect(await withUserScope(voisin, (tx) => tx.linaReleve.count())).toBe(0)
    expect(await lireReleves(voisin)).toEqual([])
    expect((await objectifsLina(voisin)).score).toBeNull()
  })
})
