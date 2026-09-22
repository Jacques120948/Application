import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import {
  lireCompteursConnecteurs,
  recompterConnecteurs,
} from '@/server/admin/compteurs'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Les compteurs de l'exploitant, et la garantie qu'ils ne défont pas.
 *
 * Le premier test est le plus important, et c'est celui qui a fait exister ce module : lus
 * sans portée — ce que fait tout écran d'administration, qui ne parle au nom de personne —
 * les comptes publicitaires n'existent pas. Un panneau bâti sur un comptage ordinaire aurait
 * affiché zéro pour toujours, sans erreur et sans bruit, et personne ne va vérifier un zéro.
 *
 * Le recomptage, lui, passe chez chacun. Il doit donc trouver ce que la lecture globale ne
 * voit pas — sans qu'aucun privilège n'ait été accordé à quiconque.
 *
 * Les assertions portent sur des écarts et non sur des totaux : cette base est partagée avec
 * les autres tests, et un chiffre absolu tomberait pour une raison sans rapport.
 */

let email: string
let userId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `compteurs-conn-${Date.now()}@exemple.test`
  userId = (
    await register(
      { email, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await subscribeToTestPlan(userId)
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('les compteurs des connecteurs', () => {
  it('ne voit rien sans portée — et c’est la garantie qui tient', async () => {
    /*
     * Ce test échouerait si quelqu'un ouvrait un jour la lecture globale de cette table, par
     * une fonction privilégiée ou un rôle de contournement. Mieux vaut un test rouge qu'un
     * compteur qui « marche enfin ».
     */
    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'meta-ads',
          compteId: `garde-${Date.now()}`,
          nom: 'Invisible sans portée',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
          actif: true,
        },
      }),
    )

    expect(await prisma.adsAccount.count()).toBe(0)
    expect(await withUserScope(userId, (tx) => tx.adsAccount.count({ where: { userId } }))).toBe(1)
  })

  it('recompte en passant chez chacun, et trouve ce que la lecture globale ne voit pas', async () => {
    const instantane = await recompterConnecteurs()
    const meta = instantane.plateformes.find((une) => une.plateforme === 'meta-ads')

    expect(instantane.utilisateurs).toBeGreaterThan(0)
    expect(meta?.suivis ?? 0).toBeGreaterThan(0)
  })

  it('distingue un compte relié d’un compte suivi', async () => {
    /*
     * La distinction porte tout le panneau : « suivis » est le nombre qui multiplie les
     * appels aux plateformes. Un compte relié mais non suivi ne coûte rien.
     */
    const avant = await recompterConnecteurs()
    const metaAvant = avant.plateformes.find((une) => une.plateforme === 'meta-ads')

    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'meta-ads',
          compteId: `dormant-${Date.now()}`,
          nom: 'Relié seulement',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
        },
      }),
    )

    const apres = await recompterConnecteurs()
    const metaApres = apres.plateformes.find((une) => une.plateforme === 'meta-ads')

    expect((metaApres?.comptes ?? 0) - (metaAvant?.comptes ?? 0)).toBe(1)
    expect(metaApres?.suivis).toBe(metaAvant?.suivis)
  })

  it('ne compte pas comme lu un compte jamais synchronisé', async () => {
    /*
     * Un compte suivi qu'on ne lit plus est un tableau de bord figé : c'est exactement ce que
     * ce panneau doit rendre visible avant que la personne ne s'en plaigne.
     */
    const instantane = await recompterConnecteurs()
    const meta = instantane.plateformes.find((une) => une.plateforme === 'meta-ads')

    expect(meta?.aJour ?? 0).toBeLessThan(meta?.suivis ?? 0)
  })

  it('ne mélange pas les plateformes', async () => {
    const instantane = await recompterConnecteurs()
    const google = instantane.plateformes.find((une) => une.plateforme === 'google-ads')

    expect(google).toBeDefined()
    expect(instantane.plateformes).toHaveLength(2)
  })

  it('se relit tel qu’il a été écrit', async () => {
    const ecrit = await recompterConnecteurs()
    const relu = await lireCompteursConnecteurs()

    expect(relu?.majAt).toBe(ecrit.majAt)
    expect(relu?.plateformes).toEqual(ecrit.plateformes)
  })

  it('ne rend rien plutôt qu’un instantané abîmé', async () => {
    /*
     * `null` veut dire « la nuit n'est pas encore passée », zéro veut dire « personne n'a
     * rien relié ». Les confondre ferait chercher une panne là où il n'y a qu'une attente.
     */
    await prisma.siteSetting.upsert({
      where: { key: 'admin.connecteurs' },
      update: { value: 'pas du json' },
      create: { key: 'admin.connecteurs', value: 'pas du json' },
    })

    expect(await lireCompteursConnecteurs()).toBeNull()
  })
})
