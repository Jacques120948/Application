import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { createProject, getProject } from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { runAgent } from '@/server/agent/loop'
import { DEFAULT_AGENT_LIMITS } from '@/server/agent/limits'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { getWallet } from '@/server/billing/credits'
import { availableCredits } from '@/server/billing/credits'

/**
 * La boucle de l'agent, sur une vraie base, avec un modèle qui répond selon un script.
 *
 * Ce qui est éprouvé ici n'est pas la qualité des décisions de l'agent — cela se mesure
 * sur des demandes réelles, pas dans un test. Ce sont les quatre propriétés dont dépend la
 * sûreté du produit :
 *
 *   1. le résultat d'un outil revient bien au modèle, qui peut donc s'en servir ;
 *   2. un refus est rendu tel quel, et l'agent peut corriger ;
 *   3. les bornes arrêtent l'exécution, quoi que fasse le modèle ;
 *   4. les crédits sont réservés puis rendus, et jamais débités au-delà du plafond.
 */

let userId: string
let projectId: string
let email: string

/** Un modèle en boîte : il répond ce qu'on lui a dit de répondre, et compte ses tours. */
function scriptedClient(
  tours: Array<{ text?: string; tool?: { name: string; input: unknown } }>,
  observed: { appels: Array<Anthropic.Messages.MessageCreateParamsNonStreaming> },
): Anthropic {
  let index = 0
  return {
    messages: {
      create: async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
        observed.appels.push(params)
        // Au-delà du script, le modèle répète son dernier tour : c'est le pire cas, celui
        // d'un agent qui tourne en rond, et c'est exactement ce que les bornes doivent
        // arrêter.
        const tour = tours[Math.min(index, tours.length - 1)]!
        index += 1
        const content: Anthropic.Messages.ContentBlock[] = []
        if (tour.text !== undefined) {
          content.push({ type: 'text', text: tour.text, citations: [] } as Anthropic.Messages.TextBlock)
        }
        if (tour.tool !== undefined) {
          content.push({
            type: 'tool_use',
            id: `toolu_${index}`,
            name: tour.tool.name,
            input: tour.tool.input,
          } as Anthropic.Messages.ToolUseBlock)
        }
        return {
          id: `msg_${index}`,
          type: 'message',
          role: 'assistant',
          model: 'test',
          content,
          stop_reason: tour.tool === undefined ? 'end_turn' : 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 500, output_tokens: 200 },
        } as unknown as Anthropic.Messages.Message
      },
    },
  } as unknown as Anthropic
}

beforeAll(async () => {
  clearAll()
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  email = `agent-${Date.now()}@exemple.test`
  const created = await register(
    { email, password: 'motdepasse-2026-solide', locale: 'fr' },
    { ip: randomUUID() },
  )
  userId = created.userId
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId: 'builder', status: 'ACTIVE' },
    update: { planId: 'builder', status: 'ACTIVE' },
  })
  const idea = 'Un carnet de recettes de cuisine partagé'
  const project = await createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) })
  projectId = project.projectId
}, 60_000)

beforeEach(async () => {
  clearAll()
  await prisma.creditReservation.deleteMany({ where: { userId } })
  await prisma.creditWallet.update({ where: { userId }, data: { balance: 500 } })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
  await prisma.$disconnect()
})

describe('la boucle', () => {
  it('rend le résultat d’un outil au modèle', async () => {
    const { spec } = await getProject(userId, projectId)
    const chemin = spec.pages[0]!.path
    const observed = { appels: [] as Anthropic.Messages.MessageCreateParamsNonStreaming[] }

    const outcome = await runAgent({
      userId,
      projectId,
      spec,
      request: 'regarde la page d’accueil',
      client: scriptedClient(
        [{ tool: { name: 'lire_page', input: { chemin } } }, { text: 'J’ai regardé la page.' }],
        observed,
      ),
    })

    expect(outcome.read).toEqual([chemin])
    expect(outcome.reply).toBe('J’ai regardé la page.')
    expect(outcome.operations).toHaveLength(0)
    // Le deuxième appel contient bien le résultat de l'outil.
    const second = JSON.stringify(observed.appels[1]?.messages)
    expect(second).toContain('tool_result')
    expect(second).toContain(spec.pages[0]!.blocks[0]!.id)
  })

  it('applique une modification et la rend à l’appelant', async () => {
    const { spec } = await getProject(userId, projectId)
    const observed = { appels: [] as Anthropic.Messages.MessageCreateParamsNonStreaming[] }

    const outcome = await runAgent({
      userId,
      projectId,
      spec,
      request: 'mets le thème en sombre',
      client: scriptedClient(
        [
          {
            tool: {
              name: 'proposer_modifications',
              input: {
                resume: 'Thème en sombre',
                operations: [
                  { op: 'set', path: 'theme.mode', valueJson: '"dark"', index: 0, from: 0, to: 0 },
                ],
              },
            },
          },
          { text: 'C’est fait : le thème est passé en sombre.' },
        ],
        observed,
      ),
    })

    expect(outcome.operations).toHaveLength(1)
    expect(outcome.spec.theme.mode).toBe('dark')
    expect(outcome.summary).toBe('Thème en sombre')
    // L'application d'origine n'est pas touchée : c'est l'appelant qui décide d'en faire
    // une version.
    expect(spec.theme.mode).not.toBe('dark')
  })

  it('rend le motif d’un refus, que l’agent peut corriger', async () => {
    const { spec } = await getProject(userId, projectId)
    const observed = { appels: [] as Anthropic.Messages.MessageCreateParamsNonStreaming[] }

    await runAgent({
      userId,
      projectId,
      spec,
      request: 'casse tout',
      client: scriptedClient(
        [
          {
            tool: {
              name: 'proposer_modifications',
              input: {
                resume: 'Suppression des pages',
                operations: [
                  { op: 'delete', path: 'pages', valueJson: 'null', index: 0, from: 0, to: 0 },
                ],
              },
            },
          },
          { text: 'Je ne peux pas faire cela.' },
        ],
        observed,
      ),
    })

    const second = JSON.stringify(observed.appels[1]?.messages)
    expect(second).toContain('Refusé')
    expect(second).toContain('"is_error":true')
  })
})

describe('les bornes', () => {
  it('arrête un agent qui tourne en rond, et le dit', async () => {
    const { spec } = await getProject(userId, projectId)
    const chemin = spec.pages[0]!.path
    const observed = { appels: [] as Anthropic.Messages.MessageCreateParamsNonStreaming[] }

    // Le script ne se termine jamais : le modèle relit la même page indéfiniment.
    const outcome = await runAgent({
      userId,
      projectId,
      spec,
      request: 'tourne en rond',
      client: scriptedClient([{ tool: { name: 'lire_page', input: { chemin } } }], observed),
    })

    expect(observed.appels).toHaveLength(DEFAULT_AGENT_LIMITS.maxSteps)
    expect(outcome.steps).toBe(DEFAULT_AGENT_LIMITS.maxSteps)
    expect(outcome.stoppedBy).not.toBeNull()
    expect(outcome.reply).toContain('étapes')
  })

  it('ne débite jamais plus que le plafond', async () => {
    const { spec } = await getProject(userId, projectId)
    const chemin = spec.pages[0]!.path
    const outcome = await runAgent({
      userId,
      projectId,
      spec,
      request: 'tourne en rond',
      client: scriptedClient([{ tool: { name: 'lire_page', input: { chemin } } }], {
        appels: [],
      }),
    })
    expect(outcome.creditsSpent).toBeLessThanOrEqual(DEFAULT_AGENT_LIMITS.maxCredits)
  })
})

describe('les crédits', () => {
  it('rend la réservation à la fin, quoi qu’il arrive', async () => {
    const { spec } = await getProject(userId, projectId)
    const avant = await availableCredits(userId)

    const outcome = await runAgent({
      userId,
      projectId,
      spec,
      request: 'dis bonjour',
      client: scriptedClient([{ text: 'Bonjour.' }], { appels: [] }),
    })

    const apres = await availableCredits(userId)
    // Rien n'est gelé : le disponible n'a baissé que du débit réel.
    expect(apres).toBe(avant - outcome.creditsSpent)
    expect(await prisma.creditReservation.count({ where: { userId, releasedAt: null } })).toBe(0)
  })

  it('ne facture pas une demande à laquelle il n’a rien changé', async () => {
    const { spec } = await getProject(userId, projectId)
    const wallet = await getWallet(userId)

    const outcome = await runAgent({
      userId,
      projectId,
      spec,
      request: 'ajoute un webhook vers mon CRM',
      client: scriptedClient([{ text: 'Ce n’est pas possible aujourd’hui.' }], { appels: [] }),
    })

    expect(outcome.operations).toHaveLength(0)
    // Une réponse honnête « ce n'est pas possible » ne se facture qu'au coût réel de
    // l'appel, sans plancher d'opération.
    expect(outcome.creditsSpent).toBeLessThanOrEqual(1)
    expect(outcome.balance).toBe(wallet.balance - outcome.creditsSpent)
  })

  it('refuse de démarrer quand le disponible ne couvre pas le plafond', async () => {
    const { spec } = await getProject(userId, projectId)
    await prisma.creditWallet.update({ where: { userId }, data: { balance: 1 } })
    await expect(
      runAgent({
        userId,
        projectId,
        spec,
        request: 'change le thème',
        client: scriptedClient([{ text: 'ok' }], { appels: [] }),
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' })
  })
})
