import { createServer, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { getWallet } from '@/server/billing/credits'
import { createMonth, createVariations } from '@/server/marketing/atelier'
import { DEMO_APPS } from '@/server/demos/catalog'
import { FREE_PLAN_ID } from '@/server/billing/plans'

/**
 * L'atelier du kit, de bout en bout.
 *
 * Un moteur de substitution répond aux deux capacités avec la même vérification de
 * signature que le vrai. Ce qui est éprouvé est le chemin réel côté Evoliia : les droits,
 * le solde, l'appel signé, le débit sur les jetons rendus, et ce qui finit en base.
 *
 * Le point à ne pas rater : le débit suit la réponse, jamais la demande. Un moteur qui
 * refuse ne doit rien coûter au créateur.
 */

const SECRET = 'secret-atelier-de-plus-de-32-caracteres!'

let server: Server
let userId: string
let email: string
let projectId: string
let kitId: string
let demandes: Array<{ url: string; payload: Record<string, unknown> }> = []
let refuser = false

const semaine = Array.from({ length: 7 }, (_, day) => ({
  day,
  time: '09:00',
  angleKey: 'PROBLEM_SOLUTION' as const,
  objective: 'AWARENESS' as const,
  format: 'POST' as const,
  caption: `Publication du jour ${day + 1}.`,
  hashtags: ['artisan'],
  cta: 'Essayez',
}))

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
      demandes.push({ url: request.url ?? '', payload })

      if (refuser) {
        response.writeHead(422, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Demande invalide.' }))
        return
      }

      const usage = { inputTokens: 900, outputTokens: 600, cachedTokens: 0, model: 'claude-sonnet-5' }
      if (request.url === '/api/engine/variation') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            version: '1',
            variations: [
              { label: 'Plus direct', caption: 'Version directe.', hashtags: ['devis'], cta: 'Allez-y' },
              { label: 'Plus chaleureux', caption: 'Version chaleureuse.', hashtags: [], cta: '' },
            ],
            usage,
          }),
        )
        return
      }
      if (request.url === '/api/engine/month') {
        const posts = Array.from({ length: 8 }, (_, i) => ({
          week: Math.floor(i / 2) + 1,
          day: i % 7,
          time: '10:00',
          angleKey: 'PROBLEM_SOLUTION',
          objective: 'AWARENESS',
          format: 'POST',
          caption: `Publication ${i + 1} du mois.`,
          hashtags: [],
          cta: 'Essayez',
        }))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({ version: '1', plan: { theme: 'Se faire connaître', posts }, usage: { ...usage, outputTokens: 4000 } }),
        )
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'inconnu' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as { port: number }).port
  process.env.SOCIAL_ENGINE_URL = `http://127.0.0.1:${port}`
  process.env.SOCIAL_ENGINE_SECRET = SECRET

  email = `atelier-${Date.now()}@exemple.test`
  userId = (await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' })).userId

  // L'offre gratuite ouvre les deux fonctions le temps du test, puis les referme.
  await prisma.plan.update({
    where: { id: FREE_PLAN_ID },
    data: { features: ['social_launch_basic', 'social_content_generation', 'social_calendar'] },
  })

  /*
   * La réserve est posée à la main, et non héritée de l'offre.
   *
   * Ce qui est vérifié ici est qu'une opération débite ce qu'elle annonce — pas qu'une
   * offre commerciale est assez généreuse pour la payer. Faire dépendre l'un de l'autre,
   * c'est voir ces tests tomber le jour où quelqu'un révise une grille tarifaire, ce qui
   * est exactement arrivé.
   */
  await getWallet(userId)
  await prisma.creditWallet.update({ where: { userId }, data: { balance: 500 } })

  const project = await withUserScope(userId, (tx) =>
    tx.project.create({
      data: {
        ownerId: userId,
        name: 'Projet',
        slug: `atelier-${Date.now()}`,
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
          angles: [{ key: 'PROBLEM_SOLUTION', title: 'Gain de temps', promise: 'p', example: 'e' }],
          ideas: [
            { title: 'Idée', angleKey: 'PROBLEM_SOLUTION', format: 'POST', hook: 'h', description: 'd', visual: 'v' },
          ],
          week: semaine,
          ctas: ['Essayez'],
        },
      },
      select: { id: true },
    }),
  )
  kitId = kit.id
}, 30_000)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.user.deleteMany({ where: { email } })
  await prisma.plan.update({ where: { id: FREE_PLAN_ID }, data: { features: [] } })
  delete process.env.SOCIAL_ENGINE_URL
  delete process.env.SOCIAL_ENGINE_SECRET
})

describe('variations d’une publication', () => {
  it('envoie la publication existante au moteur, signée, et rend les versions', async () => {
    const avant = (await getWallet(userId)).balance
    const result = await createVariations(userId, { kitId, index: 2, intent: 'REWRITE', count: 2 })

    expect(result.variations).toHaveLength(2)
    expect(result.variations[0]?.label).toBe('Plus direct')

    const demande = demandes.find((entry) => entry.url === '/api/engine/variation')
    expect(demande).toBeDefined()
    const post = demande!.payload.post as { caption: string }
    expect(post.caption).toBe('Publication du jour 3.')
    expect((demande!.payload.caller as { service: string }).service).toBe('evoliia')

    // Débité sur les jetons rendus, avec le plancher de l'opération.
    const apres = (await getWallet(userId)).balance
    expect(avant - apres).toBe(result.creditsSpent)
    expect(result.creditsSpent).toBeGreaterThanOrEqual(2)
  })

  it('ne transmet le ton que lorsqu’il est demandé', async () => {
    demandes = []
    await createVariations(userId, { kitId, index: 0, intent: 'TONE', tone: 'complice', count: 1 })
    const demande = demandes[0]!
    expect(demande.payload.tone).toBe('complice')
    expect(demande.payload.network).toBeUndefined()
  })

  it('refuse une publication qui n’existe pas dans le kit', async () => {
    await expect(
      createVariations(userId, { kitId, index: 9, intent: 'REWRITE', count: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('ne coûte rien quand le moteur refuse', async () => {
    refuser = true
    const avant = (await getWallet(userId)).balance
    await expect(
      createVariations(userId, { kitId, index: 1, intent: 'SHORTEN', count: 1 }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_REQUEST' })
    refuser = false
    expect((await getWallet(userId)).balance).toBe(avant)
  })
})

describe('calendrier du mois', () => {
  it('transmet les angles retenus et enregistre le mois dans le kit', async () => {
    demandes = []
    const result = await createMonth(userId, { kitId })

    expect(result.plan.theme).toBe('Se faire connaître')
    expect(result.plan.posts).toHaveLength(8)

    const demande = demandes.find((entry) => entry.url === '/api/engine/month')
    expect(demande).toBeDefined()
    const angles = demande!.payload.angles as Array<{ title: string }>
    expect(angles.map((angle) => angle.title)).toEqual(['Gain de temps'])

    const stored = await withUserScope(userId, (tx) =>
      tx.marketingKit.findUniqueOrThrow({ where: { id: kitId }, select: { month: true } }),
    )
    expect((stored.month as { theme: string }).theme).toBe('Se faire connaître')
  })

  it('applique le plancher du mois, plus élevé que celui d’une variation', async () => {
    const avant = (await getWallet(userId)).balance
    const result = await createMonth(userId, { kitId })
    expect(result.creditsSpent).toBeGreaterThanOrEqual(12)
    expect(avant - (await getWallet(userId)).balance).toBe(result.creditsSpent)
  })
})

describe('droits', () => {
  it('referme les deux fonctions dès que l’offre ne les ouvre plus', async () => {
    await prisma.plan.update({ where: { id: FREE_PLAN_ID }, data: { features: ['social_launch_basic'] } })
    await expect(
      createVariations(userId, { kitId, index: 0, intent: 'REWRITE', count: 1 }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    await expect(createMonth(userId, { kitId })).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
  })

  it('ne laisse pas un autre compte retravailler ce kit', async () => {
    await prisma.plan.update({
      where: { id: FREE_PLAN_ID },
      data: { features: ['social_launch_basic', 'social_content_generation', 'social_calendar'] },
    })
    const autre = `atelier-autre-${Date.now()}@exemple.test`
    const autreId = (await register({ email: autre, password: 'motdepasse-2026-solide', locale: 'fr' })).userId
    await expect(
      createVariations(autreId, { kitId, index: 0, intent: 'REWRITE', count: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await prisma.user.deleteMany({ where: { email: autre } })
  })
})
