import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { DEMO_APPS } from '@/server/demos/catalog'
import { parseAppSpec } from '@/server/spec/validate'
import { setFlag } from '@/server/settings/flags'
import { countUnread, listNotifications } from '@/server/notifications/service'
import * as operations from '@/server/ai/operations'
import {
  getSupportSettings,
  readPublicSupportSettings,
  updateSupportSettings,
} from '@/server/support/settings'
import { createEntry, generateEntries, listEntries, retrieve, updateEntry } from '@/server/support/knowledge'
import {
  DAILY_LIA_LIMIT,
  listMessages,
  openTicket,
  rateConversation,
  sendMessage,
  startConversation,
  visitorHashFor,
  type Actor,
} from '@/server/support/conversation'
import {
  deleteConversation,
  getConversation,
  getSupportOverview,
  listConversations,
  listTickets,
  purgeExpired,
  replyToTicket,
  updateTicket,
} from '@/server/support/owner'
import { generateInsights, listInsights, setInsightStatus } from '@/server/support/insights'

/**
 * Lia de bout en bout, sans appel réel au modèle.
 *
 * Deux créateurs, deux applications publiées, un visiteur anonyme et un autre. Ce qui est
 * éprouvé : le droit d'allumer Lia, la base de connaissances (un brouillon n'existe pas
 * pour le visiteur), la réponse appuyée et le refus, la transmission en ticket, les
 * quotas et le plafond journalier, et surtout le cloisonnement — entre visiteurs, entre
 * applications, entre créateurs.
 */

vi.mock('@/server/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/client')>()),
  isAiAvailable: () => true,
}))

vi.mock('@/server/ai/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/ai/operations')>()),
  answerAsLia: vi.fn(),
  generateSupportFaq: vi.fn(),
  analyzeSupportConversations: vi.fn(),
}))

const askLia = vi.mocked(operations.answerAsLia)
const askFaq = vi.mocked(operations.generateSupportFaq)
const askInsights = vi.mocked(operations.analyzeSupportConversations)

const PLAN_ID = 'test-lia'
const SPEC = parseAppSpec({ ...DEMO_APPS[0]!.spec, name: 'Application de test Lia' })

let ownerA: string
let ownerB: string
let projectA: string
let projectB: string
const visitor: Actor = { visitorHash: visitorHashFor('x', '10.0.0.1', 'navigateur'), endUserId: null }
const other: Actor = { visitorHash: visitorHashFor('x', '10.0.0.2', 'navigateur'), endUserId: null }

async function creerCreateur(planId: string | null): Promise<string> {
  const account = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  if (planId !== null) {
    await prisma.subscription.create({ data: { userId: account.userId, planId, status: 'ACTIVE' } })
  }
  return account.userId
}

async function publier(ownerId: string): Promise<string> {
  return withUserScope(ownerId, async (tx) => {
    const project = await tx.project.create({
      data: {
        ownerId,
        name: SPEC.name,
        slug: `lia-${randomUUID()}`,
        draftSpec: SPEC as unknown as object,
        status: 'PUBLISHED',
        locale: 'fr',
      },
      select: { id: true },
    })
    const version = await tx.projectVersion.create({
      data: { projectId: project.id, number: 1, label: 'Test', spec: SPEC as unknown as object },
      select: { id: true },
    })
    await tx.project.update({
      where: { id: project.id },
      data: { publishedVersionId: version.id, publishedAt: new Date() },
    })
    return project.id
  })
}

beforeAll(async () => {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  /*
   * La base de cette offre de test est la première offre payante du catalogue, quelle
   * qu'elle soit — et non une offre nommée. Nommer « launch » a coûté une suite entière le
   * jour où le catalogue a changé de métier.
   */
  const launch = DEFAULT_PLANS.find((plan) => plan.priceCents > 0)!
  await prisma.plan.upsert({
    where: { id: PLAN_ID },
    update: { features: [...launch.features, 'lia_support'], liaAnswersPerMonth: 3, liaConversationsPerMonth: 4 },
    create: {
      ...launch,
      id: PLAN_ID,
      name: 'Lia (test)',
      features: [...launch.features, 'lia_support'],
      liaAnswersPerMonth: 3,
      liaConversationsPerMonth: 4,
      isActive: false,
      currency: 'EUR',
      interval: 'month',
    },
  })
  clearAll()
  ownerA = await creerCreateur(PLAN_ID)
  ownerB = await creerCreateur(null)
  ;[projectA, projectB] = await Promise.all([publier(ownerA), publier(ownerB)])
}, 60_000)

afterAll(async () => {
  await setFlag('liaV2', false)
  await prisma.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } }).catch(() => undefined)
  await prisma.plan.delete({ where: { id: PLAN_ID } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('Lia — activation et base de connaissances', () => {
  it('reste éteinte par défaut, et invisible depuis l’application', async () => {
    const settings = await getSupportSettings(ownerA, projectA)
    expect(settings.enabled).toBe(false)
    expect(settings.displayName).toBe('Lia')
    expect(await readPublicSupportSettings(projectA)).toBeNull()
    await expect(startConversation(projectA, visitor)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('ne s’allume pas sans l’offre, mais se règle quand même', async () => {
    await expect(updateSupportSettings(ownerB, projectB, { enabled: true })).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    const settings = await updateSupportSettings(ownerB, projectB, { displayName: 'Léa' })
    expect(settings.displayName).toBe('Léa')
  })

  it('s’allume pour l’offre qui l’inclut, sans révéler l’e-mail d’escalade', async () => {
    const settings = await updateSupportSettings(ownerA, projectA, {
      enabled: true,
      greeting: 'Bonjour, une question sur les devis ?',
      escalationEmail: 'support@exemple.test',
      accentColor: '#123456',
    })
    expect(settings.enabled).toBe(true)
    const publique = await readPublicSupportSettings(projectA)
    expect(publique).toMatchObject({ enabled: true, displayName: 'Lia', accentColor: '#123456' })
    expect(publique).not.toHaveProperty('escalationEmail')
  })

  it('cache un brouillon au visiteur et ne montre que ce qui est publié', async () => {
    const draft = await createEntry(ownerA, projectA, {
      question: 'Comment annuler un devis ?',
      answer: 'Ouvrez le devis et cliquez sur Annuler.',
      keywords: 'annuler, annulation, devis',
      status: 'draft',
    })
    expect(await retrieve(projectA, 'Je veux annuler mon devis')).toEqual([])
    await updateEntry(ownerA, projectA, { id: draft.id, status: 'published' })
    const found = await retrieve(projectA, 'Je veux annuler mon devis')
    expect(found.map((e) => e.id)).toEqual([draft.id])
    // L'application B ne voit rien de la base de A.
    expect(await retrieve(projectB, 'Je veux annuler mon devis')).toEqual([])
    // Le créateur B ne modifie pas la base de A.
    await expect(updateEntry(ownerB, projectA, { id: draft.id, status: 'disabled' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('propose des questions-réponses en brouillon, jamais publiées d’office', async () => {
    askFaq.mockResolvedValueOnce({
      value: {
        entries: [
          { question: 'Comment créer un devis ?', answer: 'Depuis la page Devis, bouton Nouveau.', keywords: ['créer', 'devis'] },
          { question: 'Puis-je exporter en PDF ?', answer: 'Oui, depuis le devis.', keywords: ['pdf', 'export'] },
          { question: 'Où voir mes clients ?', answer: 'Dans la page Clients.', keywords: ['clients'] },
        ],
      },
      creditsSpent: 3,
      balance: 10,
    })
    const result = await generateEntries(ownerA, projectA, 'fr')
    const generated = result.entries.filter((e) => e.kind === 'generated')
    expect(generated).toHaveLength(3)
    expect(generated.every((e) => e.status === 'draft')).toBe(true)
    expect((await listEntries(ownerB, projectA).catch((e: { code: string }) => e.code))).toBe('NOT_FOUND')
  })
})

describe('Lia — conversations, refus, tickets', () => {
  let conversationId: string

  it('ouvre une conversation et répond à partir de la base', async () => {
    const started = await startConversation(projectA, visitor)
    conversationId = started.conversationId
    expect(started.greeting).toBe('Bonjour, une question sur les devis ?')

    askLia.mockResolvedValueOnce({
      value: { answer: 'Ouvrez le devis et cliquez sur Annuler.', canAnswer: true, usedEntries: [1], category: 'usage' },
      creditsSpent: 1,
      paidByCreatorKey: false,
    })
    const reply = await sendMessage(projectA, { conversationId, content: 'Comment annuler un devis ?' }, visitor)
    expect(reply.grounded).toBe(true)
    expect(reply.escalationSuggested).toBe(false)
    expect(reply.sources).toEqual([{ question: 'Comment annuler un devis ?' }])

    // Ce que le modèle a reçu : la base sous sa balise, le message comme donnée.
    const params = askLia.mock.calls.at(-1)?.[0]
    expect(params?.knowledge).toHaveLength(1)
    expect(params?.question).toBe('Comment annuler un devis ?')
    expect(params?.ownerId).toBe(ownerA)

    const messages = await listMessages(projectA, conversationId, visitor)
    expect(messages.map((m) => m.role)).toEqual(['visitor', 'lia'])
  })

  it('refuse sans inventer quand la base ne dit rien, et propose de transmettre', async () => {
    askLia.mockResolvedValueOnce({
      value: { answer: 'Je ne peux pas répondre à cela. Votre demande peut être transmise à l’équipe.', canAnswer: false, usedEntries: [], category: 'billing' },
      creditsSpent: 1,
      paidByCreatorKey: false,
    })
    const reply = await sendMessage(projectA, { conversationId, content: 'Puis-je être remboursé ?' }, visitor)
    expect(reply.grounded).toBe(false)
    expect(reply.escalationSuggested).toBe(true)
    expect(askLia.mock.calls.at(-1)?.[0].knowledge).toEqual([])
  })

  it('ne laisse jamais un autre visiteur, ni une autre application, lire la conversation', async () => {
    await expect(listMessages(projectA, conversationId, other)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(sendMessage(projectA, { conversationId, content: 'Bonjour' }, other)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(listMessages(projectB, conversationId, visitor)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(rateConversation(projectA, { conversationId, satisfaction: 1 }, other)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('enregistre la satisfaction du visiteur', async () => {
    await rateConversation(projectA, { conversationId, satisfaction: -1 }, visitor)
    const detail = await getConversation(ownerA, projectA, conversationId)
    expect(detail.conversation.satisfaction).toBe(-1)
  })

  it('transmet la demande : ticket, conversation marquée, créateur prévenu', async () => {
    const before = await countUnread(ownerA)
    const { ticketId } = await openTicket(
      projectA,
      { conversationId, email: 'client@exemple.test', message: 'Je voudrais un remboursement du devis payé deux fois.' },
      visitor,
    )
    const tickets = await listTickets(ownerA, projectA)
    const ticket = tickets.find((t) => t.id === ticketId)
    expect(ticket).toMatchObject({ category: 'billing', priority: 'high', status: 'open', email: 'client@exemple.test' })
    const detail = await getConversation(ownerA, projectA, conversationId)
    expect(detail.conversation.status).toBe('escalated')
    expect(await countUnread(ownerA)).toBe(before + 1)
    const [notification] = await listNotifications(ownerA)
    expect(notification?.kind).toBe('support_ticket')
    // Le ticket d'un visiteur ne peut pas viser la conversation d'un autre.
    await expect(openTicket(projectA, { conversationId, message: 'Moi aussi' }, other)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('laisse le créateur traiter et répondre, jamais un autre créateur', async () => {
    const [ticket] = await listTickets(ownerA, projectA)
    await expect(updateTicket(ownerB, projectA, { id: ticket!.id, status: 'closed' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(listTickets(ownerB, projectA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(listConversations(ownerB, projectA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getConversation(ownerB, projectA, conversationId)).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const replied = await replyToTicket(ownerA, projectA, { id: ticket!.id, content: 'Nous vous remboursons le doublon.' })
    expect(replied.emailed).toBe(false) // pas de fournisseur d'e-mail en test
    const detail = await getConversation(ownerA, projectA, conversationId)
    expect(detail.messages.at(-1)).toMatchObject({ role: 'owner', content: 'Nous vous remboursons le doublon.' })
    const updated = await updateTicket(ownerA, projectA, { id: ticket!.id, status: 'resolved' })
    expect(updated.resolvedAt).not.toBeNull()
  })

  it('s’arrête au quota de réponses de l’offre, sans appeler le modèle', async () => {
    // Deux réponses données ; la troisième est la dernière permise, la quatrième refusée.
    askLia.mockResolvedValueOnce({
      value: { answer: 'Oui.', canAnswer: true, usedEntries: [1], category: 'usage' },
      creditsSpent: 1,
      paidByCreatorKey: false,
    })
    await sendMessage(projectA, { conversationId, content: 'Comment annuler un devis, encore ?' }, visitor)
    const calls = askLia.mock.calls.length
    await expect(
      sendMessage(projectA, { conversationId, content: 'Et pour annuler un devis signé ?' }, visitor),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
    expect(askLia.mock.calls.length).toBe(calls)
  })

  it('compte les chiffres du créateur', async () => {
    const overview = await getSupportOverview(ownerA, projectA)
    expect(overview.settings.enabled).toBe(true)
    expect(overview.stats.conversations).toBe(1)
    expect(overview.stats.answers).toBe(3)
    expect(overview.stats.grounded).toBe(2)
    expect(overview.stats.escalated).toBe(1)
    expect(overview.stats.thumbsDown).toBe(1)
    expect(overview.quota.answers).toMatchObject({ used: 3, limit: 3, remaining: 0 })
    expect(overview.knowledge.published).toBe(1)
    expect(overview.knowledge.draft).toBe(3)
  })

  it('se tait au plafond journalier de l’application', async () => {
    const fresh = await startConversation(projectB, other).catch((e: { code: string }) => e.code)
    expect(fresh).toBe('NOT_FOUND') // B n'a pas allumé Lia
    // Sur A : on simule une journée pleine.
    const conversation = await withUserScope(ownerA, (tx) =>
      tx.supportConversation.create({ data: { userId: ownerA, projectId: projectA, visitorHash: 'plein' }, select: { id: true } }),
    )
    await withUserScope(ownerA, (tx) =>
      tx.supportMessage.createMany({
        data: Array.from({ length: DAILY_LIA_LIMIT }, () => ({ projectId: projectA, conversationId: conversation.id, role: 'lia', content: '…' })),
      }),
    )
    await prisma.plan.update({ where: { id: PLAN_ID }, data: { liaAnswersPerMonth: 1000 } })
    const calls = askLia.mock.calls.length
    await expect(sendMessage(projectA, { conversationId, content: 'Encore une' }, visitor)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
    expect(askLia.mock.calls.length).toBe(calls)
    await withUserScope(ownerA, (tx) => tx.supportConversation.delete({ where: { id: conversation.id } }))
  })

  it('efface ce qui a dépassé la conservation, sauf une demande encore ouverte', async () => {
    const old = await withUserScope(ownerA, (tx) =>
      tx.supportConversation.create({
        data: { userId: ownerA, projectId: projectA, visitorHash: 'ancien', createdAt: new Date('2025-01-01') },
        select: { id: true },
      }),
    )
    await withUserScope(ownerA, (tx) =>
      tx.supportConversation.update({ where: { id: conversationId }, data: { createdAt: new Date('2025-01-01') } }),
    )
    await updateTicket(ownerA, projectA, { id: (await listTickets(ownerA, projectA))[0]!.id, status: 'open' })
    const deleted = await purgeExpired(ownerA, projectA, 90)
    expect(deleted).toBe(1)
    const remaining = await listConversations(ownerA, projectA)
    expect(remaining.map((c) => c.id)).toContain(conversationId)
    expect(remaining.map((c) => c.id)).not.toContain(old.id)
  })

  it('supprime une conversation à la demande du créateur, et seulement du sien', async () => {
    await expect(deleteConversation(ownerB, projectA, conversationId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await deleteConversation(ownerA, projectA, conversationId)
    await expect(getConversation(ownerA, projectA, conversationId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Lia V2 — analyses', () => {
  it('reste fermée sans le drapeau', async () => {
    await setFlag('liaV2', false)
    await expect(generateInsights(ownerA, projectA, 'fr')).rejects.toMatchObject({ code: 'UNSUPPORTED_REQUEST' })
  })

  it('dégage des thèmes, prévient des lacunes, et prépare une demande au constructeur', async () => {
    await setFlag('liaV2', true)
    const started = await startConversation(projectA, visitor)
    askLia.mockResolvedValueOnce({
      value: { answer: 'Je ne peux pas répondre à cela.', canAnswer: false, usedEntries: [], category: 'feature' },
      creditsSpent: 1,
      paidByCreatorKey: false,
    })
    await sendMessage(projectA, { conversationId: started.conversationId, content: 'Peut-on exporter en PDF ?' }, visitor)

    askInsights.mockResolvedValueOnce({
      value: {
        insights: [
          { kind: 'feature_request', title: 'Export des devis en PDF', count: 1, examples: ['Un utilisateur demande un export PDF'] },
          { kind: 'unanswered', title: 'Export PDF', count: 1, examples: [] },
        ],
      },
      creditsSpent: 3,
      balance: 5,
    })
    const before = await countUnread(ownerA)
    const result = await generateInsights(ownerA, projectA, 'fr')
    expect(result.analyzed).toBe(1)
    expect(result.insights).toHaveLength(2)
    expect(await countUnread(ownerA)).toBe(before + 1)
    const transcript = askInsights.mock.calls.at(-1)?.[2] ?? ''
    expect(transcript).toContain('V : Peut-on exporter en PDF ?')
    expect(transcript).toContain('n’a pas su répondre')

    const feature = result.insights.find((i) => i.kind === 'feature_request')!
    const moved = await setInsightStatus(ownerA, projectA, { id: feature.id, status: 'roadmap' })
    expect(moved.status).toBe('roadmap')
    await expect(setInsightStatus(ownerB, projectA, { id: feature.id, status: 'dismissed' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(listInsights(ownerB, projectA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
