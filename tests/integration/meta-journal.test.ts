import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { journalMeta, journalMetaSuivi } from '@/server/ads/envoi-meta'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Le journal des modifications faites chez Meta.
 *
 * Il est la contrepartie du droit d'écrire : un produit qui modifie la dépense de quelqu'un
 * doit pouvoir répondre à « qu'est-ce qui a été changé sur mon compte ». Une réponse
 * partielle présentée comme entière est pire qu'une absence de réponse — on cesse de
 * chercher. C'est ce que faisait le journal, qui s'arrêtait à vingt lignes en annonçant
 * « 20 modifications » alors qu'il y en avait davantage, sans qu'aucun chemin ne mène aux
 * autres.
 */

let email: string
let userId: string
let compteId: string

const TOTAL = 25

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `meta-journal-${Date.now()}@exemple.test`
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
          compteId: '333333333333333',
          nom: 'Compte du journal',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
          actif: true,
          mode: 'assiste',
          synchroAt: new Date(),
        },
        select: { id: true },
      }),
    )
  ).id

  /*
   * Des dates distinctes et décroissantes : le repère de pagination est une date, et deux
   * lignes à la même milliseconde rendraient l'ordre — donc le test — indécidable.
   */
  const debut = Date.now() - TOTAL * 60_000
  for (let rang = 0; rang < TOTAL; rang += 1) {
    await withUserScope(userId, (tx) =>
      tx.adsAction.create({
        data: {
          userId,
          accountId: compteId,
          quoi: 'budget',
          resultat: 'reussi',
          mode: 'assiste',
          avant: { budgetMicros: 10_000_000 },
          apres: { budgetMicros: 8_000_000 },
          createdAt: new Date(debut + rang * 60_000),
        },
      }),
    )
  }
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('le journal de MIRA', () => {
  it('annonce le nombre réel de modifications, pas celui qu’il affiche', async () => {
    const page = await journalMeta(userId, compteId)
    expect(page.total).toBe(TOTAL)
    expect(page.lignes.length).toBeLessThan(TOTAL)
    expect(page.encore).toBe(true)
  })

  it('rend les plus récentes d’abord', async () => {
    const page = await journalMeta(userId, compteId)
    const dates = page.lignes.map((une) => une.createdAt.getTime())
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
  })

  it('mène aux plus anciennes, sans en sauter ni en répéter', async () => {
    const premiere = await journalMeta(userId, compteId)
    const derniere = premiere.lignes.at(-1)!
    const suivante = await journalMeta(userId, compteId, { avant: derniere.createdAt })

    const vues = [...premiere.lignes, ...suivante.lignes].map((une) => une.id)
    expect(new Set(vues).size).toBe(vues.length)
    expect(vues).toHaveLength(TOTAL)
    expect(suivante.encore).toBe(false)
    // Le total ne bouge pas d'une page à l'autre : il compte, il ne décompte pas.
    expect(suivante.total).toBe(TOTAL)
  })

  /**
   * Une modification défaite il y a longtemps se lirait comme encore active dès qu'on
   * remonte assez loin, et son bouton « remettre comme avant » reparaîtrait — proposant de
   * défaire ce qui l'est déjà. Les retours arrière sont donc cherchés sur tout le compte,
   * jamais dans la seule page lue.
   */
  it('sait qu’une ligne ancienne a été défaite, même défaite depuis une autre page', async () => {
    const ancienne = (await journalMeta(userId, compteId, { avant: new Date(Date.now() - 20 * 60_000) }))
      .lignes[0]!
    expect(ancienne.restaurable).toBe(true)

    await withUserScope(userId, (tx) =>
      tx.adsAction.create({
        data: {
          userId,
          accountId: compteId,
          quoi: 'budget',
          resultat: 'reussi',
          mode: 'restauration',
          annuleId: ancienne.id,
        },
      }),
    )

    const relue = (await journalMeta(userId, compteId, { avant: new Date(Date.now() - 20 * 60_000) }))
      .lignes[0]!
    expect(relue.id).toBe(ancienne.id)
    expect(relue.annulee).toBe(true)
    expect(relue.restaurable).toBe(false)
  })

  it('nomme un geste inconnu au lieu de le décrire comme un budget', async () => {
    await withUserScope(userId, (tx) =>
      tx.adsAction.create({
        data: { userId, accountId: compteId, quoi: 'chose-nouvelle', resultat: 'reussi' },
      }),
    )
    const page = await journalMeta(userId, compteId)
    const ligne = page.lignes.find((une) => une.quoi === 'chose-nouvelle')
    expect(ligne?.resume).toContain('chose-nouvelle')
    expect(ligne?.resume).not.toContain('Budget quotidien')
  })
})

describe('le journal du compte suivi', () => {
  it('retrouve le compte sans qu’on le désigne', async () => {
    const page = await journalMetaSuivi(userId)
    expect(page.total).toBeGreaterThan(0)
  })

  it('rend un journal vide, et non une erreur, à qui ne suit aucun compte', async () => {
    const autre = `meta-journal-sans-${Date.now()}@exemple.test`
    const sansCompte = (
      await register({ email: autre, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
    ).userId
    try {
      expect(await journalMetaSuivi(sansCompte)).toEqual({ lignes: [], total: 0, encore: false })
    } finally {
      await prisma.user.deleteMany({ where: { email: autre } })
    }
  })
})
