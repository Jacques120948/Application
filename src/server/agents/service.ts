import { z } from 'zod'
import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { consume, RULES } from '@/server/auth/rate-limit'
import { ensureCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { askSpecialist } from '@/server/ai/operations'
import { AGENT_IDS, AGENTS, findAgent, TEAM_FEATURE, type AgentId } from './catalog'
import { readFacts, readProjectHeader, teamMemory } from './context'

/**
 * Les trois spécialistes, vus depuis l'application.
 *
 * L'ordre des vérifications n'est pas décoratif. Les droits d'abord, parce qu'une fonction
 * fermée ne doit pas consommer une requête ; le solde ensuite, avant le premier appel
 * réseau ; le débit en dernier, une fois la réponse obtenue. Un modèle en panne ne coûte
 * rien au créateur.
 *
 * La mémoire d'équipe n'est lue que si l'offre l'ouvre. Sans elle, chacun raisonne seul —
 * ce qui reste utile, simplement moins.
 */

export const askInput = z.object({
  projectId: z.string().uuid(),
  agent: z.enum(AGENT_IDS),
  question: z.string().trim().min(3).max(600),
  history: z
    .array(z.object({ question: z.string().max(600), answer: z.string().max(2000) }))
    .max(4)
    .default([]),
})

export type AskInput = z.infer<typeof askInput>

export type AgentView = {
  id: AgentId
  name: string
  role: string
  summary: string
  starters: string[]
  /** Ouvert par l'offre de la personne. Un spécialiste fermé s'affiche sans se cacher. */
  open: boolean
  /** Offre qui l'ouvrirait, quand il est fermé. */
  availableWith: string | null
}

export type AgentDesk = {
  projectName: string
  agents: AgentView[]
  /** Vrai quand l'offre relie les spécialistes entre eux. */
  teamEnabled: boolean
  notes: AgentNoteView[]
}

export type AgentNoteView = {
  id: string
  agent: AgentId
  agentName: string
  question: string
  answer: string
  creditsSpent: number
  createdAt: string
}

/** Coût annoncé avant de poser une question. Plancher de l'opération, voir credits.ts. */
export const SPECIALIST_ESTIMATED_CREDITS = 2

function toView(row: {
  id: string
  agent: string
  question: string
  answer: string
  creditsSpent: number
  createdAt: Date
}): AgentNoteView | null {
  const agent = findAgent(row.agent)
  if (agent === undefined) return null
  return {
    id: row.id,
    agent: agent.id,
    agentName: agent.name,
    question: row.question,
    answer: row.answer,
    creditsSpent: row.creditsSpent,
    createdAt: row.createdAt.toISOString(),
  }
}

/** État du bureau des spécialistes pour un projet. Ne déclenche aucun appel au modèle. */
export async function getDesk(userId: string, projectId: string): Promise<AgentDesk> {
  const [header, entitlements] = await Promise.all([
    readProjectHeader(userId, projectId),
    getEntitlements(userId),
  ])
  if (header === null) throw notFound("Ce projet n'existe pas.")

  const rows = await withUserScope(userId, (tx) =>
    tx.agentNote.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        agent: true,
        question: true,
        answer: true,
        creditsSpent: true,
        createdAt: true,
      },
    }),
  )

  return {
    projectName: header.name,
    teamEnabled: entitlements.granted.includes(TEAM_FEATURE),
    agents: AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      summary: agent.summary,
      starters: [...agent.starters],
      open: entitlements.granted.includes(agent.feature),
      availableWith:
        entitlements.locked.find((entry) => entry.feature.id === agent.feature)?.availableWith ??
        null,
    })),
    notes: rows.flatMap((row) => {
      const view = toView(row)
      return view === null ? [] : [view]
    }),
  }
}

/** Pose une question à un spécialiste et enregistre sa réponse. */
export async function ask(
  userId: string,
  input: AskInput,
  locale: string,
): Promise<AgentNoteView> {
  const agent = findAgent(input.agent)
  if (agent === undefined) throw notFound("Ce spécialiste n'existe pas.")

  const entitlements = await getEntitlements(userId)
  requireFeature(entitlements, agent.feature)

  const header = await readProjectHeader(userId, input.projectId)
  if (header === null) throw notFound("Ce projet n'existe pas.")

  consume(`specialiste:${userId}`, RULES.aiOperation)
  await ensureCredits(userId, 'specialist')

  const [facts, memoire] = await Promise.all([
    readFacts(agent.id, userId, input.projectId),
    entitlements.granted.includes(TEAM_FEATURE)
      ? teamMemory(userId, input.projectId, agent.id)
      : Promise.resolve(null),
  ])

  const result = await askSpecialist({
    userId,
    agent: agent.id,
    question: input.question,
    facts,
    teamMemory: memoire,
    history: input.history,
    locale,
  })

  const row = await withUserScope(userId, (tx) =>
    tx.agentNote.create({
      data: {
        userId,
        projectId: input.projectId,
        agent: agent.id,
        question: input.question,
        answer: result.answer,
        takeaway: result.takeaway,
        creditsSpent: result.creditsSpent,
      },
      select: {
        id: true,
        agent: true,
        question: true,
        answer: true,
        creditsSpent: true,
        createdAt: true,
      },
    }),
  )

  const view = toView(row)
  if (view === null) throw notFound("Ce spécialiste n'existe pas.")
  return view
}

