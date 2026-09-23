import { z } from 'zod'
import { notFound } from '@/lib/errors'
import { askVisibilityAgent } from '@/server/ai/operations'
import { consume, RULES } from '@/server/auth/rate-limit'
import { ensureCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { withUserScope } from '@/server/db/scope'
import { readSiteFacts, siteMemory } from './visibility-context'
import {
  findVisibilityAgent,
  VISIBILITY_AGENT_IDS,
  VISIBILITY_AGENTS,
  type VisibilityAgentId,
} from './visibility'

/**
 * L'équipe de visibilité, vue depuis l'application.
 *
 * L'ordre des vérifications n'est pas décoratif, et il est le même que pour les autres
 * spécialistes de la maison : les droits d'abord, parce qu'une fonction fermée ne doit pas
 * consommer une requête ; le site ensuite, parce qu'un identifiant venu du navigateur
 * n'ouvre rien ; le solde avant le premier appel réseau ; le débit en dernier, une fois la
 * réponse obtenue. Un modèle en panne ne coûte rien à personne.
 *
 * Ce qui distingue cette équipe de l'autre tient en une phrase : elle parle d'un site qu'on
 * ne possède pas. Tout ce qu'elle avance vient des contrôles, qui sont du calcul, et jamais
 * d'une supposition du modèle sur ce qu'il n'a pas lu.
 */

export const askVisibilityInput = z.object({
  siteId: z.string().uuid(),
  agent: z.enum(VISIBILITY_AGENT_IDS),
  question: z.string().trim().min(3).max(600),
  history: z
    .array(z.object({ question: z.string().max(600), answer: z.string().max(2000) }))
    .max(4)
    .default([]),
})

export type AskVisibilityInput = z.infer<typeof askVisibilityInput>

export type VisibilityAgentView = {
  id: VisibilityAgentId
  name: string
  role: string
  avatar: string
  summary: string
  starters: string[]
  /** Ouvert par l'offre de la personne. Un spécialiste fermé s'affiche sans se cacher. */
  open: boolean
  /** Offre qui l'ouvrirait, quand il est fermé. */
  availableWith: string | null
}

export type VisibilityNoteView = {
  id: string
  agent: VisibilityAgentId
  agentName: string
  question: string
  answer: string
  creditsSpent: number
  createdAt: string
}

export type VisibilityDesk = {
  siteHost: string
  agents: VisibilityAgentView[]
  notes: VisibilityNoteView[]
}

/** Coût annoncé avant de poser une question. Plancher de l'opération, voir credits.ts. */
export const VISIBILITY_ASK_ESTIMATED_CREDITS = 2

/** Au-delà, l'écran devient un journal : personne ne remonte vingt échanges. */
const NOTES_MAX = 20

function toView(row: {
  id: string
  agent: string
  question: string
  answer: string
  creditsSpent: number
  createdAt: Date
}): VisibilityNoteView | null {
  const agent = findVisibilityAgent(row.agent)
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

/** Le site, vérifié comme appartenant à la personne. Jamais cru sur parole. */
async function siteDe(userId: string, siteId: string) {
  return withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { id: true, host: true },
    }),
  )
}

/** L'état du bureau pour un site. Ne déclenche aucun appel au modèle, ne coûte rien. */
export async function getVisibilityDesk(
  userId: string,
  siteId: string,
): Promise<VisibilityDesk> {
  const [site, entitlements] = await Promise.all([siteDe(userId, siteId), getEntitlements(userId)])
  if (site === null) throw notFound("Ce site n'existe pas.")

  const rows = await withUserScope(userId, (tx) =>
    tx.visibilityNote.findMany({
      where: { siteId, userId },
      orderBy: { createdAt: 'desc' },
      take: NOTES_MAX,
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
    siteHost: site.host,
    agents: VISIBILITY_AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      avatar: agent.avatar ?? '',
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
export async function askVisibility(
  userId: string,
  input: AskVisibilityInput,
  locale: string,
  /**
   * Qui pose la question. Absent : la personne elle-même. « oria » : une délégation, qui
   * passe par exactement le même chemin — droits, crédits, contexte du spécialiste — et
   * n'en diffère que par cette trace.
   */
  options: { demandePar?: 'oria' | 'nova' } = {},
): Promise<VisibilityNoteView> {
  const agent = findVisibilityAgent(input.agent)
  if (agent === undefined) throw notFound("Ce spécialiste n'existe pas.")

  const entitlements = await getEntitlements(userId)
  requireFeature(entitlements, agent.feature)

  const site = await siteDe(userId, input.siteId)
  if (site === null) throw notFound("Ce site n'existe pas.")

  consume(`visibilite:${userId}`, RULES.aiOperation)
  await ensureCredits(userId, 'visibilityAsk')

  const [facts, memoire] = await Promise.all([
    readSiteFacts(agent.id, userId, input.siteId),
    siteMemory(userId, input.siteId, agent.id),
  ])

  const result = await askVisibilityAgent({
    userId,
    agent: agent.id,
    question: input.question,
    facts,
    teamMemory: memoire,
    history: input.history,
    locale,
  })

  const row = await withUserScope(userId, (tx) =>
    tx.visibilityNote.create({
      data: {
        userId,
        siteId: input.siteId,
        agent: agent.id,
        question: input.question,
        answer: result.answer,
        takeaway: result.takeaway,
        creditsSpent: result.creditsSpent,
        demandePar: options.demandePar ?? null,
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
