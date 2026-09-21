import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { fenetre } from '@/server/ads/metriques'
import { enregistrerProfil, PROFIL_VIDE } from '@/server/ads/profil'
import { ecarter, evaluerCompte, lireRecommandations } from '@/server/ads/recommandations'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * La vie d'une recommandation.
 *
 * Les règles sont vérifiées ailleurs, sur des fonctions pures. Ce qui se vérifie ici est ce
 * qui se passe entre deux nuits : une condition qui dure ne doit pas produire une ligne par
 * nuit, une condition qui cesse doit fermer la sienne, et un avis écarté ne doit pas
 * reparaître le lendemain. Ces trois propriétés sont invisibles dans un écran et décident
 * pourtant de si l'on continue à lire la liste.
 *
 * Le test tourne sous le rôle applicatif, donc sous Row Level Security forcé.
 */

const FUSEAU = 'Europe/Zurich'

let email: string
let userId: string
let accountId: string
let campagneId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `reco-${Date.now()}@exemple.test`
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
          plateforme: 'google-ads',
          compteId: '1869511296',
          nom: 'Cap Nature',
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
          type: 'SEARCH',
          statut: 'ENABLED',
          budgetMicros: 15_000_000n,
        },
      }),
    )
  ).id

  /*
   * Cent francs dépensés pour cent quarante-trois de ventes : un ROAS de 143 %. Avec une
   * marge de 40 %, il en faudrait 250. C'est une perte, et quatre ventes suffisent à le dire.
   */
  const bornes = fenetre(30, FUSEAU)
  await withUserScope(userId, (tx) =>
    tx.adsReleve.create({
      data: {
        userId,
        accountId,
        campagneId,
        jour: new Date(`${bornes.jusqua}T00:00:00Z`),
        coutMicros: 100_000_000n,
        impressions: 5_000n,
        clics: 200n,
        conversions: 4,
        valeurConversion: 143,
      },
    }),
  )

  await enregistrerProfil(userId, { ...PROFIL_VIDE, margePourcent: 40 })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('une recommandation', () => {
  it('s’ouvre quand la règle se déclenche', async () => {
    const issue = await evaluerCompte(userId)
    expect(issue.ok).toBe(true)

    const liste = await lireRecommandations(userId, accountId)
    const regles = liste.map((une) => une.regle)
    expect(regles).toContain('ads.compte.perte')
    expect(regles).toContain('ads.campagne.perte')
    // L'urgent passe devant, quoi qu'il arrive.
    expect(liste[0]?.priorite).toBe('urgent')
    // Et elle porte les chiffres qui la justifient, pas seulement un avis.
    expect(liste[0]?.observation).toContain('250 %')
  })

  it('ne se duplique pas d’une nuit à l’autre', async () => {
    /*
     * Sans l'unicité, une anomalie qui dure trois semaines produirait vingt et une lignes
     * identiques, et l'écran annoncerait vingt et un problèmes là où il y en a un.
     */
    const avant = await lireRecommandations(userId, accountId)
    const issue = await evaluerCompte(userId)
    expect(issue.ok && issue.bilan.rafraichies).toBe(avant.length)
    expect(issue.ok && issue.bilan.ouvertes).toBe(0)

    const apres = await lireRecommandations(userId, accountId)
    expect(apres).toHaveLength(avant.length)
    // La ligne est la même : son ancienneté est une information qu'on ne remet pas à zéro.
    expect(apres[0]?.id).toBe(avant[0]?.id)
  })

  it('disparaît de la liste quand on l’écarte', async () => {
    const liste = await lireRecommandations(userId, accountId)
    const cible = liste.find((une) => une.regle === 'ads.campagne.perte')
    expect(cible).toBeDefined()
    if (cible === undefined) return

    await ecarter(userId, cible.id)
    const apres = await lireRecommandations(userId, accountId)
    expect(apres.map((une) => une.regle)).not.toContain('ads.campagne.perte')
  })

  it('ne reparaît pas le lendemain', async () => {
    const issue = await evaluerCompte(userId)
    expect(issue.ok && issue.bilan.tues).toBeGreaterThan(0)
    const apres = await lireRecommandations(userId, accountId)
    expect(apres.map((une) => une.regle)).not.toContain('ads.campagne.perte')
  })

  it('revient après un mois, parce que la situation, elle, n’a pas disparu', async () => {
    const plusTard = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
    await evaluerCompte(userId, plusTard)
    const apres = await lireRecommandations(userId, accountId)
    expect(apres.map((une) => une.regle)).toContain('ads.campagne.perte')
  })

  it('se ferme quand la condition cesse', async () => {
    // La campagne se met à rapporter : 143 % devient 400 %, au-dessus du seuil de 250 %.
    await withUserScope(userId, (tx) =>
      tx.adsReleve.updateMany({ where: { campagneId, userId }, data: { valeurConversion: 400 } }),
    )

    const issue = await evaluerCompte(userId)
    expect(issue.ok && issue.bilan.fermees).toBeGreaterThan(0)

    const apres = await lireRecommandations(userId, accountId)
    expect(apres.map((une) => une.regle)).not.toContain('ads.compte.perte')

    /*
     * Périmée, pas effacée : on doit pouvoir dire qu'elle a existé et quand elle a cessé.
     * Une liste qui oublie ses avis résolus ne peut rien raconter du travail accompli.
     */
    const fermees = await withUserScope(userId, (tx) =>
      tx.adsRecommandation.findMany({ where: { userId, accountId, etat: 'perimee' } }),
    )
    expect(fermees.length).toBeGreaterThan(0)
    expect(fermees[0]?.closedAt).not.toBeNull()
  })

  it('refuse d’écarter la recommandation d’un autre', async () => {
    const autre = `voisin-${Date.now()}@exemple.test`
    const voisin = (
      await register(
        { email: autre, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId
    const liste = await lireRecommandations(userId, accountId)
    if (liste[0] !== undefined) {
      await expect(ecarter(voisin, liste[0].id)).rejects.toThrow()
    }
    await prisma.user.deleteMany({ where: { email: autre } })
  })
})
