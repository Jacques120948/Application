import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { changerMode } from '@/server/ads/actions'
import { appliquerActionMeta, journalMeta, restaurerActionMeta } from '@/server/ads/envoi-meta'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Les portes fermées de l'écriture Meta.
 *
 * Ce fichier ne vérifie pas qu'une modification part : il vérifie qu'elle **ne part pas**
 * tant qu'une seule des conditions manque. C'est la moitié du travail qui compte — une
 * écriture qui échoue se voit et se corrige, une écriture qui part alors qu'elle n'aurait pas
 * dû se paie sur la dépense de quelqu'un et ne se découvre que le lendemain.
 *
 * Aucun appel réseau n'a lieu ici, et c'est la démonstration : si un seul de ces cas
 * atteignait Meta, le test ne passerait pas — il n'y a pas de jeton valide dans une base de
 * test. Les refus arrivent donc tous **avant** le premier octet envoyé.
 *
 * Le test tourne sous le rôle applicatif, donc sous Row Level Security forcé.
 */

let email: string
let userId: string
let accountId: string

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `envoi-meta-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await subscribeToTestPlan(userId)

  accountId = (
    await withUserScope(userId, (tx) =>
      tx.adsAccount.create({
        data: {
          userId,
          plateforme: 'meta-ads',
          compteId: '664979634006686',
          nom: 'Cap-Nature',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
          actif: true,
          mode: 'lecture',
          synchroAt: new Date(),
        },
      }),
    )
  ).id
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('l’interrupteur d’exploitation', () => {
  it('ferme l’écriture Meta pour tout le monde, avant toute autre question', async () => {
    /*
     * Éteint par défaut, et c'est le premier verrou. Tant qu'il l'est, le mode du compte,
     * les droits accordés par Meta et l'état des constats ne regardent personne.
     */
    const issue = await appliquerActionMeta(userId, randomUUID())
    expect(issue.ok).toBe(false)
    if (issue.ok) return
    expect(issue.raison).toContain('n’est pas ouvert')
  })

  it('ferme aussi le retour arrière', async () => {
    const issue = await restaurerActionMeta(userId, randomUUID())
    expect(issue.ok).toBe(false)
    if (issue.ok) return
    expect(issue.raison).toContain('n’est pas ouvert')
  })

  it('refuse de passer un compte Meta en assisté', async () => {
    /*
     * Refusé plutôt qu'accepté sans effet : un réglage qui s'enregistre et ne change rien
     * est pire qu'un refus, parce qu'on croit ensuite que le produit peut écrire.
     */
    await expect(changerMode(userId, 'assiste', 'meta-ads')).rejects.toThrow()
  })

  it('laisse repasser un compte en lecture, quoi qu’il arrive', async () => {
    // Fermer ne doit jamais être empêché : c'est le geste qui protège.
    const compte = await changerMode(userId, 'lecture', 'meta-ads')
    expect(compte.mode).toBe('lecture')
    expect(compte.plateforme).toBe('meta-ads')
  })
})

describe('le mode d’un compte', () => {
  it('appartient à sa plateforme, et pas à la personne', async () => {
    /*
     * `changerMode` visait toujours le compte Google : le commutateur de l'écran de MIRA
     * changeait donc le mode d'un compte qu'on ne regardait pas, et il ne se passait rien
     * chez Meta. Sans compte Google relié, il échouait même franchement.
     */
    await expect(changerMode(userId, 'lecture', 'google-ads')).rejects.toThrow()
    // Alors que le compte Meta, lui, existe et répond.
    expect((await changerMode(userId, 'lecture', 'meta-ads')).id).toBe(accountId)
  })
})

describe('le journal', () => {
  it('est vide tant que rien n’a été envoyé, et ne lève pas', async () => {
    expect(await journalMeta(userId, accountId)).toEqual({
      lignes: [],
      total: 0,
      encore: false,
    })
  })
})
