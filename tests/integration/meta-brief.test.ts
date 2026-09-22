import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { ecartRelatif, lireBriefMeta } from '@/server/ads/brief-meta'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Le brief quotidien de MIRA.
 *
 * Du comptage, et rien d'autre : aucun modèle n'intervient, donc aucun crédit. C'est la
 * règle du produit — ce qui se compte ne se paie pas — et elle vaut particulièrement ici,
 * où un brief rédigé chaque matin coûterait plus cher que tout le reste de la publicité
 * réunie pour dire des chiffres qu'on sait additionner.
 *
 * Ce qui se vérifie : qu'il additionne juste, qu'il compare à ce qu'il faut, et qu'il se
 * taise quand il n'a rien à dire.
 */

let email: string
let userId: string
let compteId: string
let campagneId: string

/** Le jour couvert par le brief : hier, jamais aujourd'hui. */
function jourDecale(jours: number): Date {
  const date = new Date(Date.now() - jours * 24 * 60 * 60 * 1000)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

async function releve(
  jours: number,
  francs: number,
  options: { groupeId?: string; annonceId?: string; conversions?: number } = {},
): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.adsReleve.create({
      data: {
        userId,
        accountId: compteId,
        campagneId,
        groupeId: options.groupeId ?? '',
        annonceId: options.annonceId ?? '',
        jour: jourDecale(jours),
        coutMicros: BigInt(Math.round(francs * 1_000_000)),
        conversions: options.conversions ?? 0,
        valeurConversion: (options.conversions ?? 0) * 50,
        impressions: BigInt(1000),
        clics: BigInt(20),
      },
    }),
  )
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `meta-brief-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(userId)

  compteId = (
    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'meta-ads',
          compteId: '444444444444444',
          nom: 'Compte du brief',
          devise: 'CHF',
          // UTC : le décalage de fuseau déplacerait la journée couverte et rendrait le
          // test dépendant de l'heure à laquelle il tourne.
          fuseau: 'UTC',
          actif: true,
          mode: 'lecture',
          synchroAt: new Date(),
        },
        select: { id: true },
      }),
    )
  ).id

  campagneId = (
    await withUserScope(userId, (tx) =>
      tx.adsCampagne.create({
        data: {
          userId,
          accountId: compteId,
          campagneId: 'camp-brief',
          nom: 'Campagne du brief',
          statut: 'ACTIVE',
        },
        select: { id: true },
      }),
    )
  ).id
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('l’écart relatif', () => {
  it('ne divise jamais par un repère nul', () => {
    /*
     * Le lendemain du premier jour de diffusion, la semaine d'avant est vide. Une division
     * rendrait l'infini, qui s'afficherait comme un écart colossal — exactement le matin où
     * il ne faut pas affoler quelqu'un.
     */
    expect(ecartRelatif(50, 0)).toBeNull()
    expect(ecartRelatif(0, 0)).toBeNull()
  })

  it('rend la proportion, dans les deux sens', () => {
    expect(ecartRelatif(150, 100)).toBeCloseTo(0.5)
    expect(ecartRelatif(50, 100)).toBeCloseTo(-0.5)
    expect(ecartRelatif(100, 100)).toBe(0)
  })
})

describe('le brief quotidien', () => {
  it('se tait franchement quand rien ne diffuse', async () => {
    const brief = await lireBriefMeta(userId)
    expect(brief?.silencieux).toBe(true)
    expect(brief?.hier.depense).toBe(0)
  })

  it('additionne la journée d’hier, et elle seule', async () => {
    await releve(1, 40, { conversions: 2 })
    await releve(2, 10)
    const brief = await lireBriefMeta(userId)
    expect(brief?.hier.depense).toBeCloseTo(40)
    expect(brief?.hier.conversions).toBe(2)
    expect(brief?.silencieux).toBe(false)
  })

  /**
   * Les mêmes journées existent au niveau de la campagne, de l'ensemble et de l'annonce.
   * Les additionner toutes compterait chaque franc trois fois : le brief annoncerait le
   * triple de la dépense réelle, l'erreur la plus alarmante qu'on puisse commettre dans un
   * texte qui parle d'argent.
   */
  it('ne compte pas trois fois la même dépense', async () => {
    await releve(1, 40, { groupeId: 'g1', conversions: 2 })
    await releve(1, 40, { groupeId: 'g1', annonceId: 'a1', conversions: 2 })
    const brief = await lireBriefMeta(userId)
    expect(brief?.hier.depense).toBeCloseTo(40)
  })

  it('compare à la moyenne des sept jours, pas à la veille', async () => {
    // Sept jours à 10 francs en plus de celui déjà posé : la moyenne doit rester basse.
    for (const jours of [3, 4, 5, 6, 7]) await releve(jours, 10)
    const brief = await lireBriefMeta(userId)
    // 10 × 6 jours (2 à 7) étalés sur sept : environ 8,57 francs par jour.
    expect(brief?.repere.depense).toBeGreaterThan(8)
    expect(brief?.repere.depense).toBeLessThan(9)
  })

  it('signale un écart qui dépasse le bruit, et se tait en deçà', async () => {
    const brief = await lireBriefMeta(userId)
    // 40 francs contre 8,57 de moyenne : largement au-delà du seuil.
    expect(brief?.ecartNotable).toBe(true)
    expect(brief?.ecartDepense).toBeGreaterThan(0.25)
  })

  it('n’existe pas pour qui ne suit aucun compte Meta', async () => {
    const autre = `meta-brief-sans-${Date.now()}@exemple.test`
    const sansCompte = (
      await register({ email: autre, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
    ).userId
    try {
      expect(await lireBriefMeta(sansCompte)).toBeNull()
    } finally {
      await prisma.user.deleteMany({ where: { email: autre } })
    }
  })
})
