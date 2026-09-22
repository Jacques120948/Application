import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { alertesMeta } from '@/server/ads/recommandations-meta'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Ce qui sort de l'écran de MIRA pour venir sur le tableau de bord.
 *
 * MIRA tourne la nuit et ouvre ses constats chez elle. Quelqu'un qui n'y va pas ne sait
 * rien, et il n'y va pas parce que rien ne l'y appelle : un budget qui part sans vente se
 * découvrait une semaine plus tard, sur un relevé.
 *
 * Le tri est donc tout l'objet de ces tests, et il se joue dans les deux sens. Trop peu
 * remonter laisse passer ce qui coûte. Trop remonter installe une alerte permanente — et
 * une alerte permanente n'alerte plus de rien : on apprend à ne plus la lire, y compris le
 * jour où elle a raison.
 */

let email: string
let userId: string
let compteId: string

async function constat(priorite: string, titre: string, etat = 'ouverte'): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.adsRecommandation.create({
      data: {
        userId,
        accountId: compteId,
        regle: `essai-${randomUUID()}`,
        priorite,
        etat,
        titre,
        cible: 'Un ensemble',
        cibleId: randomUUID(),
      },
    }),
  )
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `meta-alertes-${Date.now()}@exemple.test`
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
          compteId: '222222222222222',
          nom: 'Compte d’essai',
          devise: 'CHF',
          fuseau: 'Europe/Zurich',
          actif: true,
          mode: 'lecture',
          synchroAt: new Date(),
        },
        select: { id: true },
      }),
    )
  ).id
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('les alertes de MIRA', () => {
  it('ne dit rien quand il n’y a rien — et rend null, pas zéro', async () => {
    /*
     * La nuance décide de l'écran : un objet à zéro afficherait une bande annonçant qu'il
     * n'y a rien à signaler, ce qui est exactement le bruit qu'on veut éviter.
     */
    expect(await alertesMeta(userId)).toBeNull()
  })

  it('ne remonte pas ce qui mérite d’être lu sans appeler de geste', async () => {
    await constat('surveiller', 'Un CPM qui monte')
    await constat('information', 'Une créative qui vieillit')
    await constat('opportunite', 'Une créative qui gagne')
    expect(await alertesMeta(userId)).toBeNull()
  })

  it('remonte ce qui coûte pendant qu’on ne regarde pas', async () => {
    await constat('urgent', 'Un ensemble dépense sans convertir')
    const vue = await alertesMeta(userId)
    expect(vue?.combien).toBe(1)
    expect(vue?.premiers[0]?.titre).toBe('Un ensemble dépense sans convertir')
    expect(vue?.compteId).toBe(compteId)
  })

  it('ignore un constat déjà écarté ou refermé', async () => {
    await constat('urgent', 'Un constat écarté', 'ecartee')
    await constat('urgent', 'Un constat refermé', 'fermee')
    expect((await alertesMeta(userId))?.combien).toBe(1)
  })

  it('nomme au plus trois constats, et dit combien il en reste', async () => {
    for (const rang of [2, 3, 4, 5]) await constat('urgent', `Urgence ${rang}`)
    const vue = await alertesMeta(userId)
    expect(vue?.combien).toBe(5)
    expect(vue?.premiers).toHaveLength(3)
  })
})

describe('les alertes de quelqu’un qui n’a pas de compte Meta', () => {
  it('ne cherchent rien et ne lèvent pas', async () => {
    const autre = `meta-alertes-sans-${Date.now()}@exemple.test`
    const sansCompte = (
      await register({ email: autre, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
    ).userId
    try {
      expect(await alertesMeta(sansCompte)).toBeNull()
    } finally {
      await prisma.user.deleteMany({ where: { email: autre } })
    }
  })
})
