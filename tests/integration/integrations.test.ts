import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { decryptSecret } from '@/lib/crypto'
import {
  connectWithApiKey,
  countConnections,
  disconnect,
  listConnections,
  markConnectionError,
  useCredential,
} from '@/server/integrations/service'
import { INTEGRATION_PROVIDERS } from '@/server/integrations/catalog'
import { DEFAULT_PLANS, FREE_PLAN_ID } from '@/server/billing/plans'

const TEST_PLAN = 'test-connexions'

/**
 * Gestionnaire d'intégrations, sur une vraie base.
 *
 * Ce qui est vérifié ici tient en une phrase : un secret confié par un créateur ne doit
 * ressortir ni en clair, ni chez quelqu'un d'autre, ni après une déconnexion.
 */

let userId: string
let email: string
let otherId: string
let otherEmail: string

/** Fournisseur fictif, pour éprouver la mécanique sans ouvrir un vrai service. */
const TEST_PROVIDER = {
  ...INTEGRATION_PROVIDERS[0]!,
  id: 'fournisseur-de-test',
  status: 'available' as const,
  credential: 'API_KEY' as const,
  connectionTarget: 'EVOLIIA' as const,
}

beforeAll(async () => {
  clearAll()
  email = `integr-${Date.now()}@exemple.test`
  otherEmail = `autre-${Date.now()}@exemple.test`
  userId = (await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' })).userId
  otherId = (await register({ email: otherEmail, password: 'motdepasse-2026-solide', locale: 'fr' }))
    .userId

  // Le catalogue est figé dans le code : on y ajoute le fournisseur de test pour la durée
  // de la suite, plutôt que d'ouvrir un vrai service au public.
  ;(INTEGRATION_PROVIDERS as unknown as Array<typeof TEST_PROVIDER>).push(TEST_PROVIDER)
  /*
   * L'offre gratuite n'autorise aucune connexion. Plutôt que de la modifier — d'autres
   * suites la lisent en parallèle — les deux comptes reçoivent une offre de test dédiée,
   * inactive, qui en accorde deux.
   */
  const free = DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)!
  await prisma.plan.upsert({
    where: { id: TEST_PLAN },
    update: { maxConnections: 2 },
    create: { ...free, id: TEST_PLAN, name: 'Connexions (test)', features: [], maxConnections: 2, isActive: false, currency: 'EUR', interval: 'month' },
  })
  for (const id of [userId, otherId]) {
    await prisma.subscription.upsert({
      where: { userId: id },
      update: { planId: TEST_PLAN, status: 'ACTIVE' },
      create: { userId: id, planId: TEST_PLAN, status: 'ACTIVE' },
    })
  }
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } })
  await prisma.plan.delete({ where: { id: TEST_PLAN } }).catch(() => undefined)
})

describe('connexion par clé du créateur', () => {
  const key = 'sk-une-cle-de-test-0123456789'

  it('enregistre la connexion sans jamais renvoyer la clé', async () => {
    const view = await connectWithApiKey(userId, {
      providerId: TEST_PROVIDER.id,
      apiKey: key,
    })
    expect(view.status).toBe('CONNECTED')
    expect(view.hint).toBe('••••6789')
    expect(JSON.stringify(view)).not.toContain(key)
  })

  it('chiffre la clé au repos', async () => {
    const stored = await withUserScope(userId, (tx) =>
      tx.integrationCredential.findFirstOrThrow({ select: { secret: true } }),
    )
    expect(stored.secret).not.toContain(key)
    expect(decryptSecret(stored.secret)).toBe(key)
  })

  it('ne laisse pas la clé dans le journal des événements', async () => {
    const events = await withUserScope(userId, (tx) =>
      tx.integrationEvent.findMany({ select: { type: true, detail: true } }),
    )
    expect(events.map((event) => event.type)).toContain('connected')
    expect(JSON.stringify(events)).not.toContain(key)
  })

  it('n’expose pas la connexion au créateur voisin', async () => {
    const mine = await listConnections(userId)
    const theirs = await listConnections(otherId)
    expect(mine.find((entry) => entry.provider.id === TEST_PROVIDER.id)?.connection).not.toBeNull()
    expect(theirs.find((entry) => entry.provider.id === TEST_PROVIDER.id)?.connection).toBeNull()
    expect(await countConnections(otherId)).toBe(0)
  })

  it('reconnecte sans empiler une seconde connexion', async () => {
    await connectWithApiKey(userId, {
      providerId: TEST_PROVIDER.id,
      apiKey: 'sk-une-autre-cle-9999',
    })
    expect(await countConnections(userId)).toBe(1)
  })

  it('refuse un service absent du catalogue', async () => {
    await expect(
      connectWithApiKey(userId, {
        providerId: 'service-inconnu',
        apiKey: key,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuse une clé pour un service qui se connecte par autorisation', async () => {
    await expect(
      connectWithApiKey(userId, {
        providerId: 'stripe',
        apiKey: key,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('utilisation du secret', () => {
  it('déchiffre la clé au moment de s’en servir, et date l’usage', async () => {
    const used = await useCredential(userId, TEST_PROVIDER.id)
    expect(used?.secret).toBe('sk-une-autre-cle-9999')

    const connection = await withUserScope(userId, (tx) =>
      tx.integrationConnection.findFirstOrThrow({
        where: { providerId: TEST_PROVIDER.id },
        select: { lastUsedAt: true },
      }),
    )
    expect(connection.lastUsedAt).not.toBeNull()
  })

  it('ne donne rien au créateur voisin', async () => {
    expect(await useCredential(otherId, TEST_PROVIDER.id)).toBeNull()
  })

  it('ne donne rien pour une portée qui n’est pas celle de la connexion', async () => {
    expect(await useCredential(userId, TEST_PROVIDER.id, { target: 'APP' })).toBeNull()
  })

  it('marque la connexion en erreur sans y écrire de secret', async () => {
    const entries = await listConnections(userId)
    const connectionId = entries.find((entry) => entry.provider.id === TEST_PROVIDER.id)?.connection
      ?.id as string

    await markConnectionError(userId, connectionId, 'Le fournisseur a refusé la clé.')

    const connection = await withUserScope(userId, (tx) =>
      tx.integrationConnection.findFirstOrThrow({
        where: { id: connectionId },
        select: { status: true, lastError: true },
      }),
    )
    expect(connection.status).toBe('ERROR')
    expect(connection.lastError).toBe('Le fournisseur a refusé la clé.')

    const events = await withUserScope(userId, (tx) =>
      tx.integrationEvent.findMany({ select: { type: true, detail: true } }),
    )
    expect(JSON.stringify(events)).not.toContain('sk-')
  })
})

describe('déconnexion', () => {
  it('supprime le secret, garde la trace', async () => {
    const entries = await listConnections(userId)
    const connectionId = entries.find((entry) => entry.provider.id === TEST_PROVIDER.id)?.connection
      ?.id
    expect(connectionId).toBeDefined()

    await disconnect(userId, connectionId as string)

    const credentials = await withUserScope(userId, (tx) =>
      tx.integrationCredential.count({ where: { connectionId } }),
    )
    expect(credentials).toBe(0)

    const connection = await withUserScope(userId, (tx) =>
      tx.integrationConnection.findFirstOrThrow({
        where: { id: connectionId },
        select: { status: true, disconnectedAt: true, scopes: true },
      }),
    )
    expect(connection.status).toBe('REVOKED')
    expect(connection.disconnectedAt).not.toBeNull()
    expect(connection.scopes).toEqual([])
    expect(await countConnections(userId)).toBe(0)
    // Et surtout : plus rien à déchiffrer, donc plus rien à faire fuir.
    expect(await useCredential(userId, TEST_PROVIDER.id)).toBeNull()
  })

  it('refuse de déconnecter la connexion d’un autre', async () => {
    const view = await connectWithApiKey(userId, {
      providerId: TEST_PROVIDER.id,
      apiKey: 'sk-encore-une-cle-4242',
    })
    await expect(disconnect(otherId, view.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
