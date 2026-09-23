import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import * as operations from '@/server/ai/operations'
import { derniersEcrits, ecrireNova } from '@/server/nova/ecrits'
import { ensureTestPlan, testPlanId } from '../helpers/plan'

/**
 * Les écrits de Nova, sur une vraie base, sans appeler de modèle.
 */

vi.mock('@/server/ai/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/operations')>()),
  syntheseNova: vi.fn(async () => ({ value: { phrases: ['Les ventes tiennent.', 'Regardez d’abord Google Ads.'] }, creditsSpent: 1 })),
  analyseNova: vi.fn(async () => ({
    value: {
      diagnostic: 'Pas de données de vente : Nova ne peut rien croiser.',
      priorites: [{ titre: 'Relier une source de ventes', pourquoi: 'Sans elle, aucun chiffre d’affaires réel.', chiffre: 'aucune source', agent: 'nova' }],
      risques: [],
      aVerifier: [],
    },
    creditsSpent: 7,
  })),
}))

let abonne: string
let voisin: string

async function creer(): Promise<string> {
  const { userId } = await register({ email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' }, { ip: randomUUID() })
  await prisma.subscription.create({ data: { userId, planId: testPlanId(), status: 'ACTIVE' } })
  return userId
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  abonne = await creer()
  voisin = await creer()
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [abonne, voisin] } } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Nova V7 — écrits à la demande', () => {
  it('écrit une synthèse, la garde, et ne la repaie pas sur un double clic', async () => {
    const premiere = await ecrireNova(abonne, 'synthese', 'fr', { periode: '30' })
    expect(premiere).toMatchObject({ genre: 'synthese', creditsSpent: 1, periode: '30 derniers jours' })
    const seconde = await ecrireNova(abonne, 'synthese', 'fr', { periode: '30' })
    expect(seconde.creditsSpent).toBe(1)
    expect(operations.syntheseNova).toHaveBeenCalledTimes(1)
    // Les faits partent comme des données, pas comme des consignes.
    expect(vi.mocked(operations.syntheseNova).mock.calls[0]![0].faits).toContain('Type d’activité déclaré')
  })

  it('écrit une analyse approfondie, relue ensuite sans rien payer', async () => {
    const analyse = await ecrireNova(abonne, 'approfondie', 'fr', { periode: '7' })
    expect(analyse).toMatchObject({ genre: 'approfondie', creditsSpent: 7, contenu: { priorites: [{ agent: 'nova' }] } })
    const derniers = await derniersEcrits(abonne)
    expect(derniers.map((un) => un.genre)).toEqual(['approfondie', 'synthese'])
  })

  it('ne montre à personne les écrits d’un autre', async () => {
    expect(await derniersEcrits(voisin)).toEqual([])
    expect(await withUserScope(voisin, (tx) => tx.novaAnalyse.count())).toBe(0)
  })

  it('refuse sans l’offre, avant tout appel', async () => {
    await prisma.subscription.deleteMany({ where: { userId: voisin } })
    vi.mocked(operations.analyseNova).mockClear()
    await expect(ecrireNova(voisin, 'approfondie', 'fr')).rejects.toBeTruthy()
    expect(operations.analyseNova).not.toHaveBeenCalled()
  })
})
