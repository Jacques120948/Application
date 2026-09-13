import { createServer, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { decryptSecret } from '@/lib/crypto'
import { connectWithApiKey, disconnect, listConnections } from '@/server/integrations/service'
import { sendWeekToSocial } from '@/server/marketing/publish'
import { setFlag } from '@/server/settings/flags'
import { DEMO_APPS } from '@/server/demos/catalog'

/**
 * Liaison d'un espace Postelya, de bout en bout.
 *
 * Un Postelya de substitution est monté dans le test : il applique la même vérification de
 * signature que le vrai et renvoie la même forme de réponse. Ce qui est éprouvé n'est donc
 * pas un simulacre mais le chemin réel côté Evoliia — signature, échange, et surtout ce qui
 * finit en base.
 *
 * Le point à ne pas rater : ce qui est conservé est l'autorisation durable, jamais le code
 * d'appairage. Un code est périmé dès qu'il a servi ; le garder ne servirait à rien et
 * laisserait traîner un secret de plus.
 */

const SECRET = 'secret-de-liaison-de-plus-de-32-caracteres'
const CODE = 'ABCD2345'
const GRANT = 'G'.repeat(48)

let server: Server
let userId: string
let email: string
let received: { service?: string; code?: string } = {}
let deposited: Array<{ batchRef: string; count: number; grant: string }> = []

beforeAll(async () => {
  clearAll()

  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const timestamp = request.headers['x-engine-timestamp'] as string
      const provided = (request.headers['x-engine-signature'] as string) ?? ''
      const expected =
        'v1=' + createHmac('sha256', SECRET).update(`v1.${timestamp}.${body}`).digest('hex')
      const a = Buffer.from(expected)
      const b = Buffer.from(provided)
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
      const payload = JSON.parse(body) as Record<string, unknown>

      if (request.url === '/api/engine/drafts') {
        if (payload.grant !== GRANT) {
          response.writeHead(403, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'Espace non relié.', code: 'LINK_REVOKED' }))
          return
        }
        const posts = payload.posts as unknown[]
        const batchRef = String(payload.batchRef)
        // Idempotence : un même lot déjà reçu ne crée rien de plus.
        const seen = deposited.some((entry) => entry.batchRef === batchRef)
        deposited.push({ batchRef, count: posts.length, grant: String(payload.grant) })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            version: '1',
            workspace: { name: 'Cap-Nature' },
            created: seen ? 0 : posts.length,
            alreadyThere: seen ? posts.length : 0,
          }),
        )
        return
      }

      received = payload as { service: string; code: string }
      if (payload.code !== CODE) {
        response.writeHead(422, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: "Ce code n'est pas valide ou a expiré." }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          version: '1',
          workspace: { id: 'ws-1', name: 'Cap-Nature' },
          grant: GRANT,
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as { port: number }).port

  process.env.SOCIAL_ENGINE_URL = `http://127.0.0.1:${port}`
  process.env.SOCIAL_ENGINE_SECRET = SECRET

  // La fonction est éteinte par défaut sur une installation neuve : on l'ouvre pour la
  // suite, et un test vérifie plus bas qu'éteinte elle ferme réellement la porte.
  await setFlag('socialPublishing', true)

  email = `liaison-${Date.now()}@exemple.test`
  userId = (await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' })).userId
  await prisma.plan.update({ where: { id: 'free' }, data: { maxConnections: 2 } })
}, 30_000)

afterAll(async () => {
  await setFlag('socialPublishing', false)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.user.deleteMany({ where: { email } })
  await prisma.plan.update({ where: { id: 'free' }, data: { maxConnections: 0 } })
  delete process.env.SOCIAL_ENGINE_URL
  delete process.env.SOCIAL_ENGINE_SECRET
})

describe('liaison d’un espace Postelya', () => {
  it('échange le code et nomme l’espace relié', async () => {
    const view = await connectWithApiKey(userId, { providerId: 'postelya', apiKey: 'abcd-2345' })
    expect(view.status).toBe('CONNECTED')
    expect(view.accountLabel).toContain('Cap-Nature')
  })

  it('normalise la saisie avant de l’envoyer', () => {
    // Le créateur recopie « abcd-2345 » tel qu'affiché ; Postelya attend « ABCD2345 ».
    expect(received.code).toBe(CODE)
    expect(received.service).toBe('evoliia')
  })

  it('conserve l’autorisation durable, jamais le code', async () => {
    const stored = await withUserScope(userId, (tx) =>
      tx.integrationCredential.findFirstOrThrow({ select: { secret: true, hint: true } }),
    )
    expect(decryptSecret(stored.secret)).toBe(GRANT)
    // Le code d'appairage ne doit subsister nulle part : il est déjà périmé.
    expect(decryptSecret(stored.secret)).not.toContain(CODE)
    expect(stored.hint).not.toContain(CODE)
  })

  it('ne renvoie jamais l’autorisation à l’écran', async () => {
    const entries = await listConnections(userId)
    const postelya = entries.find((entry) => entry.provider.id === 'postelya')
    expect(postelya?.connection).not.toBeNull()
    expect(JSON.stringify(postelya)).not.toContain(GRANT)
  })

  it('refuse un code inconnu sans rien enregistrer', async () => {
    await expect(
      connectWithApiKey(userId, { providerId: 'postelya', apiKey: 'ZZZZ9999' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('dépôt d’une semaine', () => {
  let projectId: string
  let kitId: string

  const semaine = Array.from({ length: 7 }, (_, day) => ({
    day,
    time: '10:00',
    angleKey: 'PROBLEM_SOLUTION' as const,
    objective: 'AWARENESS' as const,
    format: 'POST' as const,
    caption: `Publication du jour ${day + 1}.`,
    hashtags: ['artisan'],
    cta: 'Essayez',
  }))

  beforeAll(async () => {
    const project = await withUserScope(userId, (tx) =>
      tx.project.create({
        data: {
          ownerId: userId,
          name: 'Projet',
          slug: `envoi-${Date.now()}`,
          idea: 'une idée',
          draftSpec: DEMO_APPS[0]!.spec as unknown as object,
        },
        select: { id: true },
      }),
    )
    projectId = project.id

    const kit = await withUserScope(userId, (tx) =>
      tx.marketingKit.create({
        data: {
          userId,
          projectId,
          engineVersion: '1',
          model: 'claude-sonnet-5',
          content: {
            benefits: ['un', 'deux'],
            valueProposition: 'une promesse',
            angles: [
              { key: 'PROBLEM_SOLUTION', title: 'Gain de temps', promise: 'p', example: 'e' },
            ],
            ideas: [
              {
                title: 'Idée',
                angleKey: 'PROBLEM_SOLUTION',
                format: 'POST',
                hook: 'h',
                description: 'd',
                visual: 'v',
              },
            ],
            week: semaine,
            ctas: ['Essayez'],
          },
        },
        select: { id: true },
      }),
    )
    kitId = kit.id
  })

  it('refuse d’envoyer une semaine non approuvée', async () => {
    // Approuver est le geste par lequel le créateur dit avoir tout relu. Déposer sans lui
    // mettrait dans son espace des textes qu'il n'a peut-être jamais ouverts.
    await expect(sendWeekToSocial(userId, kitId)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(deposited).toHaveLength(0)
  })

  it('dépose les sept publications une fois la semaine approuvée', async () => {
    await withUserScope(userId, (tx) =>
      tx.marketingKit.update({ where: { id: kitId }, data: { approvedAt: new Date() } }),
    )
    const result = await sendWeekToSocial(userId, kitId)
    expect(result.created).toBe(7)
    expect(result.workspace).toBe('Cap-Nature')
    expect(deposited[0]?.grant).toBe(GRANT)
  })

  it('note le dépôt sans empêcher un renvoi', async () => {
    const kit = await withUserScope(userId, (tx) =>
      tx.marketingKit.findFirstOrThrow({ where: { id: kitId }, select: { sentToSocialAt: true } }),
    )
    expect(kit.sentToSocialAt).not.toBeNull()

    // Rejouer ne crée pas de doublon : la référence du lot est la même.
    const again = await sendWeekToSocial(userId, kitId)
    expect(again.created).toBe(0)
    expect(again.alreadyThere).toBe(7)
  })

  it('renvoie vers l’écran Connexions quand l’espace n’est plus relié', async () => {
    const entries = await listConnections(userId)
    const link = entries.find((entry) => entry.provider.id === 'postelya')?.connection
    await disconnect(userId, link!.id)

    await expect(sendWeekToSocial(userId, kitId)).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
  })
})

describe('interrupteur d’exploitation', () => {
  it('ferme la porte des deux côtés quand la fonction est éteinte', async () => {
    /*
     * Une fonction éteinte doit l'être pour de bon : cacher le bouton ne suffit pas, la
     * route reste appelable. Le service refuse donc de son côté, et le fournisseur cesse
     * d'être connectable.
     */
    await setFlag('socialPublishing', false)

    const entries = await listConnections(userId)
    const postelya = entries.find((entry) => entry.provider.id === 'postelya')
    expect(postelya?.provider.status).toBe('planned')

    await expect(
      connectWithApiKey(userId, { providerId: 'postelya', apiKey: CODE }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    // Et l'envoi, qui est la porte qui compte vraiment.
    const kit = await withUserScope(userId, (tx) =>
      tx.marketingKit.findFirstOrThrow({ where: { userId }, select: { id: true } }),
    )
    await expect(sendWeekToSocial(userId, kit.id)).rejects.toMatchObject({
      code: 'UNSUPPORTED_REQUEST',
    })

    await setFlag('socialPublishing', true)
    const reopened = await listConnections(userId)
    expect(reopened.find((entry) => entry.provider.id === 'postelya')?.provider.status).toBe(
      'available',
    )
  })
})
