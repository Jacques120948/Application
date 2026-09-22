import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LignePlan, Plan } from '@/server/audit/plan'

/**
 * Ce que l'écran de Cleo montre, et dans quel ordre.
 *
 * Trois règles se testent ici, et chacune répond à une façon de rendre l'écran trompeur.
 *
 * **Il ne montre que la conversion.** Le plan d'action porte les constats des trois
 * moteurs ; laisser passer ceux de Néo ou de Gia ferait de l'écran de Cleo un doublon du
 * tableau de bord, avec son classement propre en prime.
 *
 * **Une décision déjà prise ne se redemande pas.** Ce qui a été marqué corrigé ou ignoré
 * sort des priorités : le remettre en tête reviendrait à redemander un arbitrage rendu.
 *
 * **Les deux listes ne se recouvrent pas.** « Par quoi commencer » classe par points
 * perdus, « ce qui se règle aujourd'hui » par effort. Une même ligne dans les deux ferait
 * croire à deux chantiers, et laisserait entendre que l'effort prédit le gain.
 */

const readPlan = vi.fn()
vi.mock('@/server/audit/plan', () => ({ readPlan: (...args: unknown[]) => readPlan(...args) }))

const { lireConversion } = await import('@/server/audit/conversion')

function ligne(partiel: Partial<LignePlan> & { checkId: string }): LignePlan {
  return {
    engine: 'cro',
    label: partiel.checkId,
    why: 'Parce que.',
    scope: 'page',
    severity: 'important',
    affected: 1,
    examined: 10,
    lost: 5,
    sample: [],
    state: 'todo',
    note: '',
    corrigeable: false,
    rapide: false,
    corrections: [],
    ...partiel,
  }
}

function plan(lignes: LignePlan[], reglees: Plan['reglees'] = []): Plan {
  return { auditId: 'audit-1', finishedAt: new Date('2026-09-20'), lignes, reglees }
}

beforeEach(() => {
  readPlan.mockReset()
})

describe('la vue de Cleo', () => {
  it('ne retient que les constats de conversion', async () => {
    readPlan.mockResolvedValue(
      plan([
        ligne({ checkId: 'seo.title.absent', engine: 'seo', lost: 40 }),
        ligne({ checkId: 'geo.faq.absente', engine: 'geo', lost: 30 }),
        ligne({ checkId: 'cro.cta.absent', lost: 10 }),
      ]),
    )

    const vue = await lireConversion('u-1', 'site-1')
    expect(vue?.lignes.map((une) => une.checkId)).toEqual(['cro.cta.absent'])
    expect(vue?.priorites.map((une) => une.checkId)).toEqual(['cro.cta.absent'])
  })

  it('garde trois priorités, les plus coûteuses, dans l’ordre du plan', async () => {
    readPlan.mockResolvedValue(
      plan([
        ligne({ checkId: 'cro.reassurance.absente', lost: 10 }),
        ligne({ checkId: 'cro.cta.absent', lost: 8 }),
        ligne({ checkId: 'cro.avis.absents', lost: 6 }),
        ligne({ checkId: 'cro.h1.absent', lost: 4 }),
      ]),
    )

    const vue = await lireConversion('u-1', 'site-1')
    expect(vue?.priorites.map((une) => une.checkId)).toEqual([
      'cro.reassurance.absente',
      'cro.cta.absent',
      'cro.avis.absents',
    ])
    // Le quatrième n'a pas disparu : il est dans le plan, plus bas.
    expect(vue?.lignes).toHaveLength(4)
  })

  it('ne remet pas en tête ce qui a déjà été tranché', async () => {
    readPlan.mockResolvedValue(
      plan([
        ligne({ checkId: 'cro.avis.absents', lost: 20, state: 'ignored' }),
        ligne({ checkId: 'cro.prix.absent', lost: 15, state: 'done' }),
        ligne({ checkId: 'cro.cta.absent', lost: 5, state: 'doing' }),
      ]),
    )

    const vue = await lireConversion('u-1', 'site-1')
    expect(vue?.priorites.map((une) => une.checkId)).toEqual(['cro.cta.absent'])
    // Elles restent visibles dans le plan, avec leur état.
    expect(vue?.lignes).toHaveLength(3)
  })

  it('ne propose jamais deux fois le même constat', async () => {
    /*
     * Une ligne rapide et coûteuse a sa place dans les priorités, pas dans les deux
     * listes : la voir deux fois ferait croire à deux chantiers, et surtout laisserait
     * entendre que ce qui se corrige vite est ce qui rapporte le plus.
     */
    readPlan.mockResolvedValue(
      plan([
        ligne({ checkId: 'cro.mobile.viewport', lost: 20, rapide: true }),
        ligne({ checkId: 'cro.reassurance.absente', lost: 18 }),
        ligne({ checkId: 'cro.avis.absents', lost: 16 }),
        ligne({ checkId: 'cro.cta.muet', lost: 2, rapide: true }),
      ]),
    )

    const vue = await lireConversion('u-1', 'site-1')
    expect(vue?.priorites.map((une) => une.checkId)).toContain('cro.mobile.viewport')
    expect(vue?.rapides.map((une) => une.checkId)).toEqual(['cro.cta.muet'])
  })

  it('ne compte comme rapide que ce que le catalogue déclare tel', async () => {
    readPlan.mockResolvedValue(
      plan([
        ligne({ checkId: 'cro.reassurance.absente', lost: 20 }),
        ligne({ checkId: 'cro.avis.absents', lost: 18 }),
        ligne({ checkId: 'cro.prix.absent', lost: 16 }),
        ligne({ checkId: 'cro.livraison.absente', lost: 14 }),
      ]),
    )

    const vue = await lireConversion('u-1', 'site-1')
    expect(vue?.rapides).toEqual([])
  })

  it('ne garde de « réglé depuis » que ce qui relève de la conversion', async () => {
    readPlan.mockResolvedValue(
      plan(
        [],
        [
          { checkId: 'seo.title.absent', label: 'Titre absent', engine: 'seo', state: 'done' },
          { checkId: 'cro.h1.absent', label: 'Titre visible absent', engine: 'cro', state: 'done' },
        ],
      ),
    )

    const vue = await lireConversion('u-1', 'site-1')
    expect(vue?.reglees.map((une) => une.checkId)).toEqual(['cro.h1.absent'])
  })

  it('rend null tant qu’aucun audit n’est terminé', async () => {
    readPlan.mockResolvedValue(null)
    expect(await lireConversion('u-1', 'site-1')).toBeNull()
  })
})

describe('ce que le catalogue déclare rapide', () => {
  it('ne l’est que pour une correction qui ne demande rien à produire', async () => {
    /*
     * Le jugement porte sur l'effort, jamais sur le gain. Une balise à ajouter, un libellé
     * à réécrire : rapide. Des avis clients, une politique de retour, une grille de prix :
     * il faut d'abord que la chose existe, et aucun écran ne doit laisser croire qu'on la
     * règle dans l'après-midi.
     */
    const { CRO_CHECKS } = await import('@/server/audit/checks/cro')
    const rapide = (id: string) => CRO_CHECKS.find((check) => check.id === id)?.rapide === true

    for (const id of ['cro.mobile.viewport', 'cro.cta.muet', 'cro.h1.absent', 'cro.formulaire.long'])
      expect(rapide(id), id).toBe(true)

    for (const id of ['cro.reassurance.absente', 'cro.avis.absents', 'cro.prix.absent'])
      expect(rapide(id), id).toBe(false)
  })
})
