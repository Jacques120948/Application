import { createServer, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { decryptSecret } from '@/lib/crypto'
import { connectWithApiKey, listConnections } from '@/server/integrations/service'

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
      const payload = JSON.parse(body) as { service: string; code: string }
      received = payload
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

  email = `liaison-${Date.now()}@exemple.test`
  userId = (await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' })).userId
  await prisma.plan.update({ where: { id: 'free' }, data: { maxConnections: 2 } })
}, 30_000)

afterAll(async () => {
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
