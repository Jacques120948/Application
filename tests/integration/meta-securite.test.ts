import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { setFlag } from '@/server/settings/flags'
import { appliquerActionMeta, journalMeta, restaurerActionMeta } from '@/server/ads/envoi-meta'
import { ecarterMeta, lireRecommandationsMeta } from '@/server/ads/recommandations-meta'
import { lireTableauMeta } from '@/server/ads/tableau-meta'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Le cloisonnement de MIRA, sur le chemin qui engage de l'argent.
 *
 * MIRA met en pause des publicités et change des budgets **chez Meta**. C'est, avec les
 * paiements, le seul endroit du produit où une erreur de cloisonnement ne se répare pas :
 * un budget modifié sur le compte de quelqu'un d'autre est une dépense réelle sur son
 * compte bancaire, découverte le lendemain, et qu'aucun correctif ne rend.
 *
 * L'interrupteur d'exploitation est **allumé** dans tout ce fichier, et c'est le point
 * essentiel. Éteint, tout serait refusé et chaque test passerait sans rien prouver — la
 * pire espèce de test de sécurité, celle qui rassure sans regarder. Allumé, chaque refus
 * ci-dessous vient bien du cloisonnement et de rien d'autre.
 *
 * Deux barrières se vérifient donc ensemble : celle du code, qui filtre par propriétaire, et
 * celle de PostgreSQL, qui filtre même quand le code oublie. La seconde existe parce que la
 * première est écrite à la main à chaque requête, et qu'une main oublie.
 */

let emailAnne: string
let emailBruno: string
let anne: string
let bruno: string
let compteAnne: string
let constatAnne: string
let actionAnne: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  await setFlag('publiciteEcritureMeta', true)

  emailAnne = `meta-secu-anne-${Date.now()}@exemple.test`
  emailBruno = `meta-secu-bruno-${Date.now()}@exemple.test`
  anne = (
    await register({ email: emailAnne, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  bruno = (
    await register({ email: emailBruno, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(anne)
  await subscribeToTestPlan(bruno)

  compteAnne = (
    await withUserScope(anne, (tx) =>
      tx.adsAccount.create({
        data: {
          userId: anne,
          plateforme: 'meta-ads',
          compteId: '111111111111111',
          nom: 'Boutique d’Anne',
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

  constatAnne = (
    await withUserScope(anne, (tx) =>
      tx.adsRecommandation.create({
        data: {
          userId: anne,
          accountId: compteAnne,
          regle: 'budget-mal-place',
          niveau: 'adset',
          cible: 'ensemble',
          cibleId: 'act_1/adset_1',
          etat: 'ouverte',
          titre: 'Un ensemble dépense sans convertir',
          pourquoi: 'Trois cents francs, aucune conversion.',
          consequence: 'Le budget part là où rien ne revient.',
          recommandation: 'Baisser le budget de cet ensemble.',
        },
        select: { id: true },
      }),
    )
  ).id

  actionAnne = (
    await withUserScope(anne, (tx) =>
      tx.adsAction.create({
        data: {
          userId: anne,
          accountId: compteAnne,
          quoi: 'budget-ensemble',
          resultat: 'reussi',
          mode: 'assiste',
          avant: { budget: 1000 },
          apres: { budget: 800 },
          detail: 'Budget baissé de 10 à 8 francs.',
        },
        select: { id: true },
      }),
    )
  ).id
}, 60_000)

afterAll(async () => {
  await setFlag('publiciteEcritureMeta', false)
  await prisma.user.deleteMany({ where: { email: { in: [emailAnne, emailBruno] } } })
})

describe('ce que Bruno ne peut pas lire chez Anne', () => {
  it('ne voit aucun constat d’Anne, même en connaissant l’identifiant du compte', async () => {
    expect(await lireRecommandationsMeta(bruno, compteAnne)).toEqual([])
    // Alors qu'Anne, elle, le voit bien : sans quoi le test ne prouverait rien.
    expect((await lireRecommandationsMeta(anne, compteAnne)).map((un) => un.id)).toContain(
      constatAnne,
    )
  })

  it('ne voit aucune ligne du journal d’Anne', async () => {
    expect(await journalMeta(bruno, compteAnne)).toEqual([])
    expect((await journalMeta(anne, compteAnne)).map((une) => une.id)).toContain(actionAnne)
  })

  it('n’obtient pas le tableau de bord d’Anne', async () => {
    /*
     * Le tableau part du compte actif de la personne connectée, jamais d'un identifiant
     * reçu. Bruno n'a pas de compte Meta : il s'entend dire qu'il n'en suit aucun, et non
     * qu'il en existe un ailleurs. La nuance compte — un message qui dirait « ce compte ne
     * vous appartient pas » confirmerait son existence.
     */
    await expect(lireTableauMeta(bruno, 14)).rejects.toThrow(/aucun compte meta/iu)

    // Anne, elle, obtient bien le sien : sans quoi le refus ne prouverait rien.
    const sien = await lireTableauMeta(anne, 14)
    expect(sien.compte.id).toBe(compteAnne)
  })
})

describe('ce que Bruno ne peut pas faire chez Anne', () => {
  it('ne peut pas écarter un constat d’Anne', async () => {
    await ecarterMeta(bruno, constatAnne).catch(() => undefined)
    const chezAnne = await withUserScope(anne, (tx) =>
      tx.adsRecommandation.findFirst({ where: { id: constatAnne }, select: { etat: true } }),
    )
    expect(chezAnne?.etat).toBe('ouverte')
  })

  it('ne peut pas appliquer une modification depuis un constat d’Anne', async () => {
    /*
     * Le refus vient d'en amont : Bruno n'a aucun compte Meta, donc aucune porte à ouvrir.
     * Qu'il échoue ainsi plutôt qu'à la lecture du constat est même préférable — rien de la
     * situation d'Anne n'est seulement consulté.
     */
    const issue = await appliquerActionMeta(bruno, constatAnne).catch(() => ({
      ok: false as const,
      raison: 'levée',
    }))
    expect(issue.ok).toBe(false)
  })

  it('ne peut pas défaire une modification d’Anne', async () => {
    const issue = await restaurerActionMeta(bruno, actionAnne).catch(() => ({
      ok: false as const,
      raison: 'levée',
    }))
    expect(issue.ok).toBe(false)

    // Et la modification d'Anne n'a reçu aucun contre-ordre.
    const contre = await withUserScope(anne, (tx) =>
      tx.adsAction.count({ where: { annuleId: actionAnne } }),
    )
    expect(contre).toBe(0)
  })
})

describe('la barrière de PostgreSQL, quand le code oublie', () => {
  /**
   * Les requêtes du produit portent toutes une condition de propriété, écrite à la main.
   * Une main oublie. Ces trois cas vérifient que l'oubli ne coûte rien : la base filtre par
   * elle-même, sur la portée ouverte, et refuse d'écrire au nom d'un autre.
   */
  it('ne rend aucune ligne d’Anne dans la portée de Bruno, sans condition de propriété', async () => {
    const comptes = await withUserScope(bruno, (tx) => tx.adsAccount.findMany({}))
    const constats = await withUserScope(bruno, (tx) => tx.adsRecommandation.findMany({}))
    const actions = await withUserScope(bruno, (tx) => tx.adsAction.findMany({}))
    expect(comptes).toEqual([])
    expect(constats).toEqual([])
    expect(actions).toEqual([])
  })

  it('refuse une écriture faite au nom d’Anne depuis la portée de Bruno', async () => {
    await expect(
      withUserScope(bruno, (tx) =>
        tx.adsAction.create({
          data: {
            userId: anne,
            accountId: compteAnne,
            quoi: 'pause-annonce',
            resultat: 'reussi',
            detail: 'Tentative depuis une autre portée.',
          },
        }),
      ),
    ).rejects.toThrow()
  })

  it('ne laisse pas Bruno modifier le compte Meta d’Anne', async () => {
    const touches = await withUserScope(bruno, (tx) =>
      tx.adsAccount.updateMany({ where: { id: compteAnne }, data: { mode: 'lecture' } }),
    )
    expect(touches.count).toBe(0)

    const chezAnne = await withUserScope(anne, (tx) =>
      tx.adsAccount.findFirst({ where: { id: compteAnne }, select: { mode: true } }),
    )
    expect(chezAnne?.mode).toBe('assiste')
  })
})
