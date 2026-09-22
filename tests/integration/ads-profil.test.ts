import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import {
  depenseDuMois,
  enregistrerProfil,
  lireProfil,
  objectifsDuCompte,
  PROFIL_VIDE,
} from '@/server/ads/profil'
import { compteActif } from '@/server/ads/comptes'
import { CUMUL_VIDE, indicateurs } from '@/server/ads/metriques'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Le profil publicitaire, sous les vraies politiques de cloisonnement.
 *
 * `AdsProfil` porte ce qu'une entreprise a de plus confidentiel après ses comptes : sa marge.
 * La table est sous Row Level Security forcé, et une lecture faite hors de la portée d'un
 * propriétaire ne lève pas d'erreur — elle rend zéro ligne. Ce test tourne sous le rôle
 * applicatif, donc sous les mêmes règles que la production : un accès mal cloisonné s'y voit,
 * là où un test exécuté par le propriétaire des tables le masquerait.
 */

let emailA: string
let emailB: string
let userA: string
let userB: string
let compteAId: string

/** Un compte publicitaire créé à la main : relier Google demande une autorisation réelle. */
async function creerCompte(userId: string, compteId: string): Promise<string> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsAccount.create({
      data: {
        userId,
        plateforme: 'google-ads',
        compteId,
        nom: `Compte ${compteId}`,
        devise: 'CHF',
        fuseau: 'Europe/Zurich',
        actif: true,
        synchroAt: new Date(),
      },
    }),
  )
  return ligne.id
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  const suffixe = Date.now()
  emailA = `profil-a-${suffixe}@exemple.test`
  emailB = `profil-b-${suffixe}@exemple.test`
  userA = (
    await register(
      { email: emailA, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  userB = (
    await register(
      { email: emailB, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await subscribeToTestPlan(userA)
  await subscribeToTestPlan(userB)
  compteAId = await creerCompte(userA, '1869511296')
  await creerCompte(userB, '9999999999')
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } })
})

describe('le profil publicitaire', () => {
  it('est vide tant que personne ne l’a rempli, et se dit vide', async () => {
    expect(await lireProfil(userA, compteAId)).toEqual(PROFIL_VIDE)
  })

  it('conserve l’argent en micros et le rend en unités', async () => {
    await enregistrerProfil(userA, {
      ...PROFIL_VIDE,
      activite: 'Bougies artisanales',
      pays: 'Suisse',
      margePourcent: 40,
      panierMoyen: 64.5,
      roasCible: 300,
      cpaCible: 25.5,
      budgetMensuel: 400,
      objectif: 'roas',
    })

    const relu = await lireProfil(userA, compteAId)
    expect(relu.margePourcent).toBe(40)
    expect(relu.panierMoyen).toBe(64.5)
    expect(relu.cpaCible).toBe(25.5)
    expect(relu.budgetMensuel).toBe(400)
    expect(relu.objectif).toBe('roas')

    /*
     * Le contrôle qui compte : en base, c'est un entier long. Un nombre à virgule ferait
     * entrer une imprécision dans la seule donnée du produit qui soit de l'argent réel.
     */
    const brut = await withUserScope(userA, (tx) =>
      tx.adsProfil.findFirst({ where: { userId: userA, accountId: compteAId } }),
    )
    expect(brut?.panierMoyenMicros).toBe(64_500_000n)
    expect(brut?.cpaCibleMicros).toBe(25_500_000n)
  })

  it('se remplace au lieu de se dupliquer', async () => {
    await enregistrerProfil(userA, { ...PROFIL_VIDE, margePourcent: 45 })
    const lignes = await withUserScope(userA, (tx) =>
      tx.adsProfil.findMany({ where: { userId: userA, accountId: compteAId } }),
    )
    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.margePourcent).toBe(45)
  })

  it('reste invisible au voisin', async () => {
    // Sous RLS forcé, une lecture hors portée ne lève rien : elle rend zéro ligne. C'est
    // exactement ce qu'il faut vérifier, parce que c'est exactement ce qui ne se voit pas.
    const chezLeVoisin = await withUserScope(userB, (tx) =>
      tx.adsProfil.findMany({ where: { accountId: compteAId } }),
    )
    expect(chezLeVoisin).toHaveLength(0)
  })

  it('refuse de s’enregistrer sans compte suivi', async () => {
    await withUserScope(userB, (tx) =>
      tx.adsAccount.updateMany({ where: { userId: userB }, data: { actif: false } }),
    )
    await expect(enregistrerProfil(userB, { ...PROFIL_VIDE, margePourcent: 30 })).rejects.toThrow()
  })
})

describe('la dépense du mois', () => {
  it('vaut zéro sans relevé, sans prétendre à un rythme', async () => {
    const mois = await depenseDuMois(userA, compteAId, 'Europe/Zurich')
    expect(mois.depense).toBe(0)
    expect(mois.joursDuMois).toBeGreaterThanOrEqual(28)
  })
})

describe('la lecture des objectifs', () => {
  it('rend un verdict indéterminé quand rien n’a été dépensé', async () => {
    const compte = await compteActif(userA)
    expect(compte).not.toBeNull()
    if (compte === null) return

    const lecture = await objectifsDuCompte(userA, compte, indicateurs({ ...CUMUL_VIDE }))
    expect(lecture.renseigne).toBe(true)
    expect(lecture.lecture.seuil).toBe(Math.round(10_000 / 45))
    expect(lecture.lecture.verdict).toBe('inconnu')
  })
})

describe('les objectifs suivent leur plateforme', () => {
  /*
   * Un compte publicitaire porte ses propres chiffres.
   *
   * `enregistrerProfil` visait toujours le compte Google, d'où que vienne la demande : une
   * marge saisie sur l'écran de MIRA partait donc chez Naya, le formulaire répondait
   * « enregistré », et l'écran de MIRA continuait d'afficher qu'il manquait des objectifs.
   * Sans compte Google relié du tout, le formulaire échouait même franchement.
   */
  it('écrivent sur le compte de la plateforme demandée, et sur lui seul', async () => {
    const meta = await withUserScope(userA, (tx) =>
      tx.adsAccount.create({
        data: {
          userId: userA,
          plateforme: 'meta-ads',
          compteId: '664979634006686',
          nom: 'Cap-Nature',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
          actif: true,
          synchroAt: new Date(),
        },
      }),
    )

    await enregistrerProfil(userA, { ...PROFIL_VIDE, margePourcent: 55 }, 'meta-ads')

    // Le compte Meta porte la marge…
    expect((await lireProfil(userA, meta.id)).margePourcent).toBe(55)
    // …et le compte Google, qui n'a rien demandé, ne l'a pas.
    expect((await lireProfil(userA, compteAId)).margePourcent).not.toBe(55)

    await withUserScope(userA, (tx) => tx.adsAccount.deleteMany({ where: { id: meta.id } }))
  })

  it('visent Google par défaut, comme avant', async () => {
    await enregistrerProfil(userA, { ...PROFIL_VIDE, margePourcent: 33 })
    expect((await lireProfil(userA, compteAId)).margePourcent).toBe(33)
  })
})
