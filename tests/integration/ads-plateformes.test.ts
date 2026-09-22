import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import {
  choisirCompte,
  compteActif,
  listerComptesRelies,
  retirerCompte,
} from '@/server/ads/comptes'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Deux agents, deux plateformes, un seul cloisonnement à ne pas manquer.
 *
 * Naya suit un compte Google, MIRA un compte Meta, et les deux cohabitent chez la même
 * personne. « Actif » s'entend donc par plateforme, jamais globalement — et c'est une
 * propriété qu'aucun écran ne montre.
 *
 * Le danger est précis : `choisirCompte` désactive les autres comptes avant d'activer celui
 * qu'on désigne. Si cette désactivation ne se bornait pas à la plateforme du compte choisi,
 * relier Meta viderait le tableau de bord Google — et personne ne ferait le rapprochement
 * entre un écran vide et un clic sur un autre écran, la veille.
 *
 * Le test tourne sous le rôle applicatif, donc sous Row Level Security forcé.
 */

let email: string
let userId: string
let googleId: string
let metaId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `plateformes-${Date.now()}@exemple.test`
  userId = (
    await register(
      { email, password: 'motdepasse-2026-solide', locale: 'fr' },
      { ip: randomUUID() },
    )
  ).userId
  await subscribeToTestPlan(userId)

  googleId = (
    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'google-ads',
          compteId: '1869511296',
          nom: 'Cap Nature — Google',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
          actif: true,
        },
      }),
    )
  ).id

  metaId = (
    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'meta-ads',
          compteId: '3021884455',
          nom: 'Cap Nature — Meta',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
        },
      }),
    )
  ).id
})

/*
 * Le ménage n'est pas une politesse ici, c'est une nécessité, et l'avoir oublié a
 * immédiatement fait tomber un autre test. La tournée nocturne balaie TOUS les comptes
 * publicitaires de la base, pas ceux d'un utilisateur : trois comptes laissés derrière soi
 * sans connexion OAuth deviennent trois échecs de synchronisation, dans le bilan d'un test
 * voisin qui n'a rien à voir. La suppression de l'utilisateur emporte ses comptes en
 * cascade.
 */
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('deux plateformes chez la même personne', () => {
  it('ne mélange pas les comptes dans la liste', async () => {
    const google = await listerComptesRelies(userId, 'google-ads')
    const meta = await listerComptesRelies(userId, 'meta-ads')

    expect(google.map((compte) => compte.id)).toEqual([googleId])
    expect(meta.map((compte) => compte.id)).toEqual([metaId])
  })

  it('choisir un compte Meta ne désactive pas le compte Google', async () => {
    /*
     * Le cœur du test. Avant le cloisonnement, la désactivation portait sur « tous les
     * comptes actifs de cette personne » : relier Meta aurait éteint Naya en silence.
     */
    await choisirCompte(userId, metaId)

    expect((await compteActif(userId, 'meta-ads'))?.id).toBe(metaId)
    expect((await compteActif(userId, 'google-ads'))?.id).toBe(googleId)
  })

  it('garde Google par défaut, pour tout ce qui a été écrit avant Meta', async () => {
    /*
     * Les appels de Naya ne passent pas de plateforme. Le défaut doit donc rester Google,
     * faute de quoi tout son tableau de bord changerait de compte sans qu'une ligne de son
     * code ait bougé.
     */
    expect((await compteActif(userId))?.id).toBe(googleId)
    expect((await listerComptesRelies(userId)).map((un) => un.id)).toEqual([googleId])
  })

  it('un second compte Meta remplace le premier, sans toucher à Google', async () => {
    const autreMeta = (
      await withUserScope(userId, (tx) =>
        tx.adsAccount.create({
          data: {
            userId,
            plateforme: 'meta-ads',
            compteId: '7788990011',
            nom: 'Cap Nature — Meta bis',
            devise: 'CHF',
            fuseau: 'Europe/Zurich',
          },
        }),
      )
    ).id

    await choisirCompte(userId, autreMeta)

    expect((await compteActif(userId, 'meta-ads'))?.id).toBe(autreMeta)
    expect((await compteActif(userId, 'google-ads'))?.id).toBe(googleId)
  })

  it('porte la plateforme sur le compte rendu, pour que l’écran sache à qui il parle', async () => {
    const compte = await compteActif(userId, 'meta-ads')
    expect(compte?.plateforme).toBe('meta-ads')
  })
})

describe('retirer un compte devenu illisible', () => {
  /*
   * Un compte fermé, suspendu ou auquel on a perdu l'accès reste affiché — le cacher ferait
   * chercher un compte qu'on sait posséder — mais il encombre indéfiniment la liste où l'on
   * vient désigner celui qu'on suit. Le bouton qui le retire est donc légitime ; ce qui se
   * vérifie ici, c'est qu'il ne puisse rien retirer d'autre.
   */
  it('refuse un compte lisible, quoi que demande le navigateur', async () => {
    /*
     * La devise vide est la marque d'un compte illisible : elle vient de la plateforme, et
     * une lecture qui a abouti la rend toujours. Un compte lisible porte des campagnes, des
     * relevés, des constats — les effacer d'un bouton posé dans un écran de réglage serait
     * offrir une perte irréversible à portée de clic distrait.
     */
    await expect(retirerCompte(userId, googleId)).rejects.toThrow()
    expect(await compteActif(userId)).not.toBeNull()
  })

  it('refuse le compte d’un autre comme un compte introuvable', async () => {
    const autre = `voisin-retrait-${Date.now()}@exemple.test`
    const voisin = (
      await register(
        { email: autre, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId
    await expect(retirerCompte(voisin, metaId)).rejects.toThrow()
    await prisma.user.deleteMany({ where: { email: autre } })
  })

  it('retire un compte illisible, et lui seul', async () => {
    const illisible = await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'google-ads',
          compteId: '4342942713',
          nom: '4342942713',
          // Vide : c'est exactement ce que rend une lecture qui n'a pas abouti.
          devise: '',
          fuseau: '',
          actif: false,
        },
      }),
    )

    await retirerCompte(userId, illisible.id)

    const restants = await listerComptesRelies(userId)
    expect(restants.map((un) => un.id)).not.toContain(illisible.id)
    // Et le compte suivi n'a pas bougé : on retire une ligne, pas une liste.
    expect(restants.map((un) => un.id)).toContain(googleId)
  })
})
