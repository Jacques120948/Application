import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

/*
 * Les deux seules portes vers Google sont remplacées : on vérifie ce qu'Evoliia décide
 * d'envoyer, pas que Google réponde. Appeler le vrai service depuis un test reviendrait à
 * modifier un vrai compte publicitaire — exactement ce que tout ce module cherche à rendre
 * impossible par accident.
 */
type Envoi = { ok: true } | { ok: false; raison: string; technique: string }

const ecrireBudget = vi.fn(
  async (_acces: unknown, _budgetId: string, _micros: number): Promise<Envoi> => ({ ok: true }),
)
const ecrireStatut = vi.fn(
  async (_acces: unknown, _campagneId: string, _statut: string): Promise<Envoi> => ({ ok: true }),
)

vi.mock('@/server/ads/google-ads-ecriture', () => ({ ecrireBudget, ecrireStatut }))

vi.mock('@/server/ads/comptes', async (original) => {
  const vrai = await original<typeof import('@/server/ads/comptes')>()
  return {
    ...vrai,
    // Le renouvellement du jeton OAuth n'a rien à voir avec ce qu'on vérifie ici.
    accesCompteActif: async (userId: string) => {
      const compte = await vrai.compteActif(userId)
      return compte === null
        ? { ok: false as const, raison: 'aucun compte' }
        : {
            ok: true as const,
            acces: { accessToken: 'jeton-de-test', compteId: compte.compteId },
            compte,
          }
    },
  }
})

const { prisma } = await import('@/server/db/client')
const { clearAll } = await import('@/server/auth/rate-limit')
const { register } = await import('@/server/auth/service')
const { withUserScope } = await import('@/server/db/scope')
const { setFlag } = await import('@/server/settings/flags')
const { appliquerBudget, appliquerStatut, changerMode, lireJournal, restaurer } = await import(
  '@/server/ads/actions'
)
const { ensureTestPlan, subscribeToTestPlan } = await import('../helpers/plan')

/**
 * Le mode assisté, de la confirmation au retour arrière.
 *
 * C'est le seul endroit du produit qui touche à l'argent réel de quelqu'un. Ce qui se
 * vérifie ici tient en quatre propriétés, et chacune est invisible à l'écran : rien ne part
 * quand l'interrupteur est fermé, rien ne part quand le compte est en lecture, rien ne part
 * sur une valeur périmée, et tout ce qui part laisse de quoi revenir en arrière.
 */

const MICROS = 1_000_000

let email: string
let userId: string
let accountId: string
let campagneId: string

async function budgetActuel(): Promise<number> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsCampagne.findFirst({ where: { id: campagneId, userId }, select: { budgetMicros: true } }),
  )
  return Number(ligne?.budgetMicros ?? 0)
}

beforeAll(async () => {
  clearAll()
  await ensureTestPlan()
  email = `action-${Date.now()}@exemple.test`
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
          fuseau: 'Europe/Zurich',
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
          budgetMicros: BigInt(15 * MICROS),
          budgetId: '900',
        },
      }),
    )
  ).id
}, 60_000)

afterAll(async () => {
  await setFlag('publiciteEcriture', false)
  await prisma.user.deleteMany({ where: { email } })
})

beforeEach(() => {
  ecrireBudget.mockClear()
  ecrireStatut.mockClear()
})

describe('les verrous', () => {
  it('n’envoient rien tant que l’interrupteur d’exploitation est fermé', async () => {
    await setFlag('publiciteEcriture', false)
    const issue = await appliquerBudget(userId, {
      campagneId,
      versMicros: 18 * MICROS,
      attenduMicros: 15 * MICROS,
    })
    expect(issue.ok).toBe(false)
    expect(ecrireBudget).not.toHaveBeenCalled()
    // Rien n'est même journalisé : la question ne s'est pas posée.
    expect(await lireJournal(userId, accountId)).toHaveLength(0)
  })

  it('refusent de passer un compte en assisté quand l’interrupteur est fermé', async () => {
    /*
     * Refusé plutôt qu'enregistré sans effet : un réglage qui s'affiche « assisté » et ne
     * peut rien envoyer est pire qu'un refus, parce qu'on croit ensuite que ça marche.
     */
    await expect(changerMode(userId, 'assiste')).rejects.toThrow()
  })

  it('n’envoient rien tant que le compte est en lecture seule', async () => {
    await setFlag('publiciteEcriture', true)
    const issue = await appliquerBudget(userId, {
      campagneId,
      versMicros: 18 * MICROS,
      attenduMicros: 15 * MICROS,
    })
    expect(issue.ok).toBe(false)
    expect(ecrireBudget).not.toHaveBeenCalled()
  })

  it('refusent une valeur qui a changé depuis l’affichage', async () => {
    await setFlag('publiciteEcriture', true)
    await changerMode(userId, 'assiste')

    const issue = await appliquerBudget(userId, {
      campagneId,
      versMicros: 18 * MICROS,
      // Le navigateur croyait 40 ; la base dit 15. On ne devine pas laquelle est la bonne.
      attenduMicros: 40 * MICROS,
    })
    expect(issue.ok).toBe(false)
    if (!issue.ok) expect(issue.raison).toContain('changé')
    expect(ecrireBudget).not.toHaveBeenCalled()
  })

  it('refusent un budget partagé par plusieurs campagnes', async () => {
    const voisine = await withUserScope(userId, (tx) =>
      tx.adsCampagne.create({
        data: {
          userId,
          accountId,
          campagneId: '222',
          nom: 'Coffrets',
          type: 'SHOPPING',
          statut: 'ENABLED',
          budgetMicros: BigInt(15 * MICROS),
          // Le même budget Google : le modifier ici changerait aussi celui de Coffrets.
          budgetId: '900',
        },
      }),
    )

    const issue = await appliquerBudget(userId, {
      campagneId,
      versMicros: 18 * MICROS,
      attenduMicros: 15 * MICROS,
    })
    expect(issue.ok).toBe(false)
    if (!issue.ok) expect(issue.raison).toContain('partagé')
    expect(ecrireBudget).not.toHaveBeenCalled()

    await withUserScope(userId, (tx) => tx.adsCampagne.deleteMany({ where: { id: voisine.id } }))
  })
})

describe('une modification de budget', () => {
  it('part chez Google et laisse sa valeur d’avant', async () => {
    await setFlag('publiciteEcriture', true)
    await changerMode(userId, 'assiste')

    const issue = await appliquerBudget(userId, {
      campagneId,
      versMicros: 18 * MICROS,
      attenduMicros: 15 * MICROS,
    })
    expect(issue.ok).toBe(true)
    expect(ecrireBudget).toHaveBeenCalledTimes(1)
    // Le budget Google, pas la campagne : chez Google, c'est un objet à part.
    expect(ecrireBudget.mock.calls[0]?.[1]).toBe('900')
    expect(ecrireBudget.mock.calls[0]?.[2]).toBe(18 * MICROS)

    // La copie locale suit, pour que l'écran ne montre pas l'ancienne valeur.
    expect(await budgetActuel()).toBe(18 * MICROS)

    const journal = await lireJournal(userId, accountId)
    expect(journal[0]?.resultat).toBe('reussi')
    expect(journal[0]?.avant).toEqual({ budgetMicros: 15 * MICROS })
    expect(journal[0]?.apres).toEqual({ budgetMicros: 18 * MICROS })
  })

  it('revient exactement à la valeur d’avant', async () => {
    const journal = await lireJournal(userId, accountId)
    const derniere = journal[0]
    expect(derniere).toBeDefined()
    if (derniere === undefined) return

    const issue = await restaurer(userId, derniere.id)
    expect(issue.ok).toBe(true)
    expect(ecrireBudget).toHaveBeenCalledWith(expect.anything(), '900', 15 * MICROS)
    expect(await budgetActuel()).toBe(15 * MICROS)

    const apres = await lireJournal(userId, accountId)
    expect(apres[0]?.restauration).toBe(true)
    // L'action d'origine est marquée comme annulée : on ne l'annule pas deux fois.
    expect(apres.find((une) => une.id === derniere.id)?.annulee).toBe(true)
  })

  it('ne s’annule pas deux fois', async () => {
    const journal = await lireJournal(userId, accountId)
    const annulee = journal.find((une) => une.annulee)
    expect(annulee).toBeDefined()
    if (annulee === undefined) return
    const issue = await restaurer(userId, annulee.id)
    expect(issue.ok).toBe(false)
  })
})

describe('une mise en pause', () => {
  it('part, se journalise et se défait', async () => {
    const issue = await appliquerStatut(userId, {
      campagneId,
      vers: 'PAUSED',
      attendu: 'ENABLED',
    })
    expect(issue.ok).toBe(true)
    expect(ecrireStatut).toHaveBeenCalledWith(expect.anything(), '111', 'PAUSED')

    const journal = await lireJournal(userId, accountId)
    expect(journal[0]?.quoi).toBe('pause')
    expect(journal[0]?.avant).toEqual({ statut: 'ENABLED' })

    const retour = await restaurer(userId, journal[0]?.id ?? '')
    expect(retour.ok).toBe(true)
    expect(ecrireStatut).toHaveBeenLastCalledWith(expect.anything(), '111', 'ENABLED')
  })
})

describe('un refus de Google', () => {
  it('laisse une trace, et ne touche pas à la copie locale', async () => {
    ecrireBudget.mockResolvedValueOnce({
      ok: false,
      raison: 'Google refuse : budget trop bas pour ce compte.',
      technique: 'BUDGET_TOO_LOW',
    })

    const avant = await budgetActuel()
    const issue = await appliquerBudget(userId, {
      campagneId,
      versMicros: 18 * MICROS,
      attenduMicros: avant,
    })
    expect(issue.ok).toBe(false)

    /*
     * Un journal qui ne garderait que ce qui a réussi laisserait croire que rien n'a été
     * tenté les jours où Google a dit non.
     */
    const journal = await lireJournal(userId, accountId)
    expect(journal[0]?.resultat).toBe('refuse')
    expect(journal[0]?.detail).toContain('BUDGET_TOO_LOW')
    expect(await budgetActuel()).toBe(avant)
  })
})

describe('le cloisonnement', () => {
  it('refuse d’agir sur la campagne d’un autre', async () => {
    const autre = `voisin-action-${Date.now()}@exemple.test`
    const voisin = (
      await register(
        { email: autre, password: 'motdepasse-2026-solide', locale: 'fr' },
        { ip: randomUUID() },
      )
    ).userId

    // Le voisin n'a pas de compte suivi : la demande s'arrête avant même la campagne.
    const issue = await appliquerBudget(voisin, {
      campagneId,
      versMicros: 18 * MICROS,
      attenduMicros: 15 * MICROS,
    })
    expect(issue.ok).toBe(false)
    expect(ecrireBudget).not.toHaveBeenCalled()

    await prisma.user.deleteMany({ where: { email: autre } })
  })
})
