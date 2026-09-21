import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { fenetre } from '@/server/ads/metriques'
import { lireTableauAds } from '@/server/ads/tableau'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Le tableau de bord, monté sur de vraies journées.
 *
 * Les calculs sont vérifiés ailleurs, sur des fonctions pures. Ce qui se vérifie ici est ce
 * qu'elles deviennent une fois assemblées avec la base : la courbe doit comporter une entrée
 * par jour de la fenêtre, y compris les jours sans dépense, et les campagnes doivent sortir
 * dans l'ordre demandé. Une courbe qui saute les jours vides rapprocherait deux barres
 * séparées par une semaine de silence — un graphique faux qui a l'air juste.
 *
 * Le test tourne sous le rôle applicatif, donc sous Row Level Security forcé, comme la
 * production.
 */

const FUSEAU = 'Europe/Zurich'

let email: string
let userId: string
let accountId: string
let campagneForte: string
let campagneFaible: string

async function creerCampagne(nom: string, campagneId: string, budget: bigint): Promise<string> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsCampagne.create({
      data: {
        userId,
        accountId,
        campagneId,
        nom,
        type: 'SEARCH',
        statut: 'ENABLED',
        budgetMicros: budget,
      },
    }),
  )
  return ligne.id
}

async function releve(campagneId: string, jour: string, coutMicros: bigint, valeur: number) {
  await withUserScope(userId, (tx) =>
    tx.adsReleve.create({
      data: {
        userId,
        accountId,
        campagneId,
        jour: new Date(`${jour}T00:00:00Z`),
        coutMicros,
        impressions: 1_000n,
        clics: 40n,
        conversions: 2,
        valeurConversion: valeur,
      },
    }),
  )
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `tableau-${Date.now()}@exemple.test`
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

  campagneForte = await creerCampagne('Bougies', '111', 15_000_000n)
  campagneFaible = await creerCampagne('Coffrets', '222', 5_000_000n)
  await creerCampagne('Ancienne', '333', 1_000_000n)

  /*
   * Deux journées seulement, aux deux bouts de la fenêtre : c'est ce qui rend le trou du
   * milieu visible, et le trou du milieu est précisément ce que la courbe doit dessiner.
   */
  const bornes = fenetre(7, FUSEAU)
  await releve(campagneForte, bornes.jusqua, 60_000_000n, 200)
  await releve(campagneFaible, bornes.depuis, 20_000_000n, 90)
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('le tableau de bord', () => {
  it('agrège la période et calcule la part de chaque campagne', async () => {
    const tableau = await lireTableauAds(userId, 7)
    expect(tableau.total.cout).toBe(80)
    expect(tableau.total.valeur).toBe(290)
    // 290 de valeur pour 80 de dépense : 362 %.
    expect(tableau.total.roas).toBe(Math.round((290 / 80) * 100))

    const forte = tableau.campagnes.find((campagne) => campagne.id === campagneForte)
    const faible = tableau.campagnes.find((campagne) => campagne.id === campagneFaible)
    expect(forte?.part).toBe(75)
    expect(faible?.part).toBe(25)
  })

  it('dessine une entrée par journée, y compris les journées sans dépense', async () => {
    const tableau = await lireTableauAds(userId, 7)
    const bornes = fenetre(7, FUSEAU)

    expect(tableau.serie).toHaveLength(7)
    expect(tableau.serie[0]?.jour).toBe(bornes.depuis)
    expect(tableau.serie[6]?.jour).toBe(bornes.jusqua)

    // Les jours vides valent zéro, ce qui n'est pas la même chose qu'une donnée absente.
    const creux = tableau.serie.slice(1, 6)
    expect(creux.every((jour) => jour.cout === 0)).toBe(true)
    // Un jour sans dépense n'a pas un ROAS de 0 % : il n'en a pas.
    expect(creux.every((jour) => jour.roas === null)).toBe(true)

    expect(tableau.serie[6]?.cout).toBe(60)
    expect(tableau.serie[0]?.cout).toBe(20)
  })

  it('compte les journées où la campagne a réellement dépensé', async () => {
    /*
     * Une journée sans dépense n'est pas une journée de diffusion. Ce compte est ce qui
     * empêche de comparer trois jours de reprise à trente jours pleins et d'appeler ça
     * une chute.
     */
    const tableau = await lireTableauAds(userId, 7)
    const forte = tableau.campagnes.find((campagne) => campagne.id === campagneForte)
    expect(forte?.joursActifs).toBe(1)
    expect(forte?.joursActifsAvant).toBe(0)

    const ancienne = tableau.campagnes.find((campagne) => campagne.nom === 'Ancienne')
    expect(ancienne?.joursActifs).toBe(0)
  })

  it('classe les campagnes par dépense, la plus grosse en tête', async () => {
    const tableau = await lireTableauAds(userId, 7, 'depense')
    expect(tableau.campagnes[0]?.id).toBe(campagneForte)
    expect(tableau.campagnes[1]?.id).toBe(campagneFaible)
  })

  it('range en bas les campagnes dont l’indicateur n’existe pas', async () => {
    /*
     * Trier par ROAS en mettant en tête celles qui n'en ont pas ferait passer pour
     * meilleures celles qui n'ont simplement rien dépensé.
     */
    const tableau = await lireTableauAds(userId, 7, 'roas')
    expect(tableau.campagnes[tableau.campagnes.length - 1]?.nom).toBe('Ancienne')
    expect(tableau.campagnes[0]?.actuel.roas).not.toBeNull()
  })

  it('garde les campagnes sans dépense plutôt que de les effacer', async () => {
    // Une campagne en pause ou à budget épuisé est exactement celle dont on veut parler.
    const tableau = await lireTableauAds(userId, 7)
    expect(tableau.campagnes).toHaveLength(3)
  })
})
