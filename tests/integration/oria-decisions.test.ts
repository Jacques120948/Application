import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { withUserScope } from '@/server/db/scope'
import { lireDecisions } from '@/server/oria/decisions'
import { ensureTestPlan, subscribeToTestPlan } from '../helpers/plan'

/**
 * Le journal des décisions, sur une vraie base.
 *
 * Une modification vieille de dix jours se mesure ; une modification d'avant-hier attend ;
 * une recommandation écartée figure sans mesure ; et rien de tout cela ne se voit depuis
 * un autre compte.
 */

const J = 24 * 60 * 60 * 1000
let anne: string
let bruno: string
let emailAnne: string
let emailBruno: string
const maintenant = new Date('2026-09-23T12:00:00Z')

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  emailAnne = `decisions-anne-${Date.now()}@exemple.test`
  emailBruno = `decisions-bruno-${Date.now()}@exemple.test`
  anne = (await register({ email: emailAnne, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })).userId
  bruno = (await register({ email: emailBruno, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })).userId
  await subscribeToTestPlan(anne)
  await subscribeToTestPlan(bruno)

  await withUserScope(anne, async (tx) => {
    const compte = await tx.adsAccount.create({
      data: { userId: anne, plateforme: 'meta-ads', compteId: '444444444444444', nom: 'Anne', devise: 'CHF', fuseau: 'Europe/Zurich', actif: true, mode: 'assiste' },
    })
    const campagne = await tx.adsCampagne.create({
      data: { userId: anne, accountId: compte.id, campagneId: 'c-anne', nom: 'Automne', statut: 'ACTIVE' },
    })
    // Trois semaines de relevés : 2 conversions par jour avant la décision, 3 après.
    const decision = new Date('2026-09-10T15:00:00Z')
    for (let j = -10; j <= 11; j += 1) {
      const jour = new Date(Date.UTC(2026, 8, 10) + j * J)
      if (j === 0) continue
      await tx.adsReleve.create({
        data: {
          userId: anne, accountId: compte.id, campagneId: campagne.id, jour,
          coutMicros: BigInt(20_000_000), clics: BigInt(30), impressions: BigInt(1000),
          conversions: j < 0 ? 2 : 3,
        },
      })
    }
    const reco = await tx.adsRecommandation.create({
      data: {
        userId: anne, accountId: compte.id, campagneId: campagne.id, regle: 'budget', etat: 'appliquee',
        titre: 'Le budget bride une campagne rentable', recommandation: 'Monter le budget de « Automne ».',
      },
    })
    await tx.adsAction.create({
      data: {
        userId: anne, accountId: compte.id, campagneId: campagne.id, quoi: 'budget', resultat: 'reussi',
        mode: 'assiste', recommandationId: reco.id, createdAt: decision,
      },
    })
    await tx.adsAction.create({
      data: {
        userId: anne, accountId: compte.id, campagneId: campagne.id, quoi: 'pause', resultat: 'reussi',
        mode: 'assiste', createdAt: new Date(+maintenant - 2 * J),
      },
    })
    await tx.adsRecommandation.create({
      data: {
        userId: anne, accountId: compte.id, regle: 'fatigue', etat: 'ignoree', closedAt: new Date(+maintenant - 3 * J),
        titre: 'Renouveler les visuels',
      },
    })
  })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [emailAnne, emailBruno] } } })
})

describe('le journal des décisions', () => {
  it('mesure une modification dont la semaine d’après est écoulée', async () => {
    const decisions = await lireDecisions(anne, null, maintenant)
    const budget = decisions.find((un) => un.quoi === 'Monter le budget de « Automne ».')
    expect(budget?.genre).toBe('appliquee')
    expect(budget?.proposePar).toEqual(['meta'])
    expect(budget?.impact?.etat).toBe('mesure')
    if (budget?.impact?.etat !== 'mesure') return
    const conversions = budget.impact.mesures.find((un) => un.quoi === 'Conversions')
    // Sept jours à 2, sept jours à 3 — le jour de la décision n'est compté nulle part.
    expect(conversions?.avant).toBe(14)
    expect(conversions?.apres).toBe(21)
    expect(conversions?.sens).toBe('mieux')
  })

  it('attend quand la semaine d’après n’est pas écoulée', async () => {
    const decisions = await lireDecisions(anne, null, maintenant)
    const recente = decisions.find((un) => un.quand > new Date(+maintenant - 3 * J) && un.genre === 'appliquee')
    expect(recente?.impact?.etat).toBe('en-attente')
  })

  it('garde trace de ce qui a été écarté, sans rien mesurer', async () => {
    const decisions = await lireDecisions(anne, null, maintenant)
    const ecartee = decisions.find((un) => un.quoi === 'Renouveler les visuels')
    expect(ecartee?.genre).toBe('ecartee')
    expect(ecartee?.impact).toBeNull()
  })

  it('ne montre rien d’Anne à Bruno', async () => {
    expect(await lireDecisions(bruno, null, maintenant)).toEqual([])
  })
})
