import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import {
  ecarterMeta,
  evaluerCompteMeta,
  lireRecommandationsMeta,
} from '@/server/ads/recommandations-meta'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * La vie d'un constat de MIRA.
 *
 * Les règles elles-mêmes sont vérifiées ailleurs, sur des fonctions pures. Ce qui se vérifie
 * ici est ce qui se passe entre deux nuits, et qu'aucun écran ne montre : une condition qui
 * dure ne doit pas produire une ligne par nuit, une condition qui cesse doit fermer la
 * sienne, un constat écarté ne doit pas reparaître le lendemain — et, ce qui est propre à
 * Meta, **deux annonces de la même campagne qui fatiguent en même temps doivent donner deux
 * lignes**. Tant que la clé d'unicité valait la règle et la campagne, la seconde était
 * refusée par la base et chaque nuit réécrivait l'unique ligne avec les chiffres de l'une
 * puis de l'autre : on affichait un problème là où il y en avait deux, et jamais le même.
 *
 * Le test tourne sous le rôle applicatif, donc sous Row Level Security forcé.
 */

const FUSEAU = 'Europe/Zurich'
const JOUR_MS = 24 * 60 * 60 * 1000

let email: string
let userId: string
let accountId: string
let campagneId: string
let annonceA: string
let annonceB: string

/** Le jour J-n, à minuit UTC, tel que la base le range. */
function jourIl(n: number): Date {
  const date = new Date(Date.now() - n * JOUR_MS)
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00Z`)
}

/**
 * Une annonce qui fatigue : les trois signaux ensemble, jamais un seul.
 *
 * Fréquence 3 (9 000 affichages pour 3 000 personnes), taux de clic divisé par deux, et coût
 * des mille affichages qui double. Aucun des trois ne suffirait, et c'est le propos de la
 * règle.
 */
async function annonceFatiguee(annonceId: string, nom: string, groupe: string) {
  const annonce = await withUserScope(userId, (tx) =>
    tx.adsAnnonce.create({
      data: { userId, accountId, groupeId: groupe, annonceId, nom, statut: 'ACTIVE' },
    }),
  )

  await withUserScope(userId, (tx) =>
    tx.adsReleve.createMany({
      data: [
        {
          userId,
          accountId,
          campagneId,
          groupeId: 'g1',
          annonceId,
          jour: jourIl(3),
          coutMicros: 60_000_000n,
          impressions: 9_000n,
          clics: 90n,
          portee: 3_000n,
        },
        {
          userId,
          accountId,
          campagneId,
          groupeId: 'g1',
          annonceId,
          jour: jourIl(20),
          coutMicros: 30_000_000n,
          impressions: 10_000n,
          clics: 200n,
          portee: 4_000n,
        },
      ],
    }),
  )

  return annonce.id
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `mira-reco-${Date.now()}@exemple.test`
  userId = (
    await register(
      { email, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await subscribeToTestPlan(userId)

  accountId = (
    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'meta-ads',
          compteId: 'act_664979634006686',
          nom: 'Cap-Nature',
          devise: 'CHF',
          fuseau: FUSEAU,
          actif: true,
          synchroAt: new Date(),
        },
      }),
    )
  ).id

  campagneId = (
    await withUserScope(userId, (tx) =>
      tx.adsCampagne.create({
        data: {
          userId,
          accountId,
          campagneId: '111',
          nom: 'Bougies',
          type: 'OUTCOME_SALES',
          statut: 'ACTIVE',
          budgetMicros: 0n,
        },
      }),
    )
  ).id

  const groupe = await withUserScope(userId, (tx) =>
    tx.adsGroupe.create({
      data: {
        userId,
        accountId,
        campagneId,
        groupeId: 'g1',
        nom: 'Suisse romande',
        statut: 'ACTIVE',
        budgetMicros: 20_000_000n,
      },
    }),
  )

  /*
   * Les deux annonces vivent dans le même ensemble, donc dans la même campagne. C'est
   * exactement le cas que l'ancienne clé d'unicité confondait.
   */
  annonceA = await annonceFatiguee('a1', 'Visuel bougie bleue', groupe.id)
  annonceB = await annonceFatiguee('a2', 'Visuel bougie rouge', groupe.id)

  /*
   * Les lignes de campagne, pour que le compte ait un total. Leur coût des mille affichages
   * baisse d'une période à l'autre : sans cela, la règle de hausse du CPM se déclencherait
   * aussi et brouillerait ce que ce test cherche à dire.
   */
  await withUserScope(userId, (tx) =>
    tx.adsReleve.createMany({
      data: [
        {
          userId,
          accountId,
          campagneId,
          jour: jourIl(3),
          coutMicros: 120_000_000n,
          impressions: 18_000n,
          clics: 180n,
          portee: 6_000n,
        },
        {
          userId,
          accountId,
          campagneId,
          jour: jourIl(20),
          coutMicros: 60_000_000n,
          impressions: 8_000n,
          clics: 400n,
          portee: 5_000n,
        },
      ],
    }),
  )
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('un constat de MIRA', () => {
  it('ouvre une ligne par annonce, même quand elles partagent la campagne', async () => {
    const issue = await evaluerCompteMeta(userId)
    expect(issue.ok).toBe(true)

    const liste = await lireRecommandationsMeta(userId, accountId)
    const fatigues = liste.filter((un) => un.regle === 'meta.creative.fatigue')
    expect(fatigues).toHaveLength(2)
    expect(new Set(fatigues.map((un) => un.cibleId))).toEqual(new Set([annonceA, annonceB]))
    // Deux lignes distinctes, pas une ligne réécrite deux fois.
    expect(fatigues[0]?.id).not.toBe(fatigues[1]?.id)
    // Et chacune vise l'annonce, pas la campagne : c'est là que la pause a un sens.
    expect(fatigues.every((un) => un.niveau === 'annonce')).toBe(true)
  })

  it('est tenu unique par la base, et pas seulement par le code', async () => {
    /*
     * Le dédoublonnage en mémoire suffirait tant qu'une seule évaluation tourne à la fois.
     * Ce n'est pas le cas : la tournée nocturne et le bouton « relire mes campagnes »
     * peuvent se croiser. Sans contrainte en base, le croisement écrirait deux lignes
     * identiques, et l'écran annoncerait deux problèmes là où il y en a un.
     */
    const liste = await lireRecommandationsMeta(userId, accountId)
    const un = liste.find((constat) => constat.cibleId === annonceA)
    expect(un).toBeDefined()
    if (un === undefined) return

    await expect(
      withUserScope(userId, (tx) =>
        tx.adsRecommandation.create({
          data: {
            userId,
            accountId,
            regle: 'meta.creative.fatigue',
            cibleId: annonceA,
            etat: 'ouverte',
          },
        }),
      ),
    ).rejects.toThrow()
  })

  it('porte les chiffres qui l’ont déclenché, et les quatre temps', async () => {
    const liste = await lireRecommandationsMeta(userId, accountId)
    const un = liste.find((constat) => constat.regle === 'meta.creative.fatigue')
    expect(un).toBeDefined()
    if (un === undefined) return

    expect(un.priorite).toBe('urgent')
    expect(un.donnees.frequence).toBe(3)
    // Le mécanisme, la conséquence et la proposition sont écrits, pas devinés à l'affichage.
    expect(un.pourquoi).not.toBe('')
    expect(un.consequence).not.toBe('')
    expect(un.recommandation).not.toBe('')
  })

  it('ne se duplique pas d’une nuit à l’autre', async () => {
    const avant = await lireRecommandationsMeta(userId, accountId)
    const issue = await evaluerCompteMeta(userId)
    expect(issue.ok && issue.bilan.ouvertes).toBe(0)
    expect(issue.ok && issue.bilan.rafraichies).toBe(avant.length)

    const apres = await lireRecommandationsMeta(userId, accountId)
    expect(apres).toHaveLength(avant.length)
    // Les mêmes lignes : leur ancienneté est une information qu'on ne remet pas à zéro.
    expect(apres.map((un) => un.id).sort()).toEqual(avant.map((un) => un.id).sort())
  })

  it('disparaît quand on l’écarte, sans emporter celui d’à côté', async () => {
    const liste = await lireRecommandationsMeta(userId, accountId)
    const cible = liste.find((un) => un.cibleId === annonceA)
    expect(cible).toBeDefined()
    if (cible === undefined) return

    await ecarterMeta(userId, cible.id)
    const apres = await lireRecommandationsMeta(userId, accountId)
    expect(apres.map((un) => un.cibleId)).not.toContain(annonceA)
    expect(apres.map((un) => un.cibleId)).toContain(annonceB)
  })

  it('ne reparaît pas le lendemain', async () => {
    const issue = await evaluerCompteMeta(userId)
    expect(issue.ok && issue.bilan.tues).toBe(1)
    const apres = await lireRecommandationsMeta(userId, accountId)
    expect(apres.map((un) => un.cibleId)).not.toContain(annonceA)
  })

  it('revient après un mois, parce que la situation, elle, n’a pas disparu', async () => {
    await evaluerCompteMeta(userId, new Date(Date.now() + 31 * JOUR_MS))
    const apres = await lireRecommandationsMeta(userId, accountId)
    expect(apres.map((un) => un.cibleId)).toContain(annonceA)
  })

  it('se ferme quand la condition cesse, et laisse l’autre ouvert', async () => {
    /*
     * L'annonce A cesse de fatiguer : sa portée rejoint ses affichages, donc sa fréquence
     * tombe à 1. Les deux autres signaux n'y changent rien — la règle les veut ensemble.
     */
    await withUserScope(userId, (tx) =>
      tx.adsReleve.updateMany({
        where: { userId, accountId, annonceId: 'a1' },
        data: { portee: 9_000n },
      }),
    )

    const issue = await evaluerCompteMeta(userId)
    expect(issue.ok && issue.bilan.fermees).toBe(1)

    const apres = await lireRecommandationsMeta(userId, accountId)
    expect(apres.map((un) => un.cibleId)).not.toContain(annonceA)
    expect(apres.map((un) => un.cibleId)).toContain(annonceB)

    /*
     * Périmée, pas effacée : on doit pouvoir dire qu'elle a existé et quand elle a cessé.
     * Une liste qui oublie ses constats résolus ne peut rien raconter du travail accompli.
     */
    const fermees = await withUserScope(userId, (tx) =>
      tx.adsRecommandation.findMany({ where: { userId, accountId, etat: 'perimee' } }),
    )
    expect(fermees).toHaveLength(1)
    expect(fermees[0]?.closedAt).not.toBeNull()
  })

  it('refuse d’écarter le constat d’un autre', async () => {
    const autre = `voisin-mira-${Date.now()}@exemple.test`
    const voisin = (
      await register(
        { email: autre, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId
    const liste = await lireRecommandationsMeta(userId, accountId)
    expect(liste.length).toBeGreaterThan(0)
    if (liste[0] !== undefined) {
      await expect(ecarterMeta(voisin, liste[0].id)).rejects.toThrow()
    }
    await prisma.user.deleteMany({ where: { email: autre } })
  })
})
