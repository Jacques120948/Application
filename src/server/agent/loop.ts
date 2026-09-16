import type Anthropic from '@anthropic-ai/sdk'
import { AppError } from '@/lib/errors'
import { consume, RULES } from '@/server/auth/rate-limit'
import { costMicros, creditsFor, loadPricing } from '@/server/billing/ai-pricing'
import { MINIMUM_COST, spendCredits } from '@/server/billing/credits'
import { releaseReservation, reserveCredits } from '@/server/billing/reservation'
import { prisma } from '@/server/db/client'
import { getAnthropic, isAiAvailable } from '@/server/ai/client'
import { describeFailure } from '@/server/ai/operations'
import { asUserData } from '@/server/ai/prompts'
import { documentBlocks, type AttachedDocument } from '@/server/ai/documents'
import { MODELS } from '@/server/ai/routing'
import { logger } from '@/server/observability/logger'
import type { AppSpec } from '@/server/spec/schema'
import type { PatchOperation } from '@/server/spec/patch'
import { canContinue, loadAgentLimits, newBudget, type AgentLimits } from './limits'
import { AGENT_SYSTEM } from './prompt'
import { recentIncidents } from './incidents'
import { AGENT_TOOLS, newWorkspace, outline, runTool, type Workspace } from './tools'

/**
 * La boucle de l'agent.
 *
 * Ce qui la distingue de la modification à coup unique : l'agent peut **regarder avant de
 * décider**. Il reçoit un plan de l'application — toutes les pages, tous les blocs, leurs
 * indices — puis ouvre ce dont il a besoin, propose des modifications, lit le motif du
 * refus quand il y en a un, et corrige. Ce va-et-vient est ce qui lui permet de répondre à
 * « ajoute un espace membre », qui touche à plusieurs pages et au réglage des comptes.
 *
 * Ce qu'elle n'est pas : un agent libre. Trois choses l'encadrent, et elles sont
 * délibérément redondantes.
 *
 * **Les bornes** (voir `limits.ts`) sont vérifiées avant chaque appel, jamais après.
 * Constater un dépassement une fois l'appel payé ne protège de rien.
 *
 * **Les outils** (voir `tools.ts`) sont sa seule prise sur le monde. Il n'écrit pas dans
 * la base, ne joint aucun réseau, et ne modifie rien directement : il propose, le serveur
 * valide et applique sur une copie de travail.
 *
 * **La réservation** met les crédits de côté avant le premier appel. Une boucle qui
 * partirait en vrille ne peut pas dépenser plus que ce qui a été réservé, et ce qui n'a
 * pas été consommé est rendu.
 *
 * Rien n'est écrit dans le projet ici. La boucle rend une spécification et des opérations ;
 * c'est l'appelant qui décide d'en faire une version.
 */

export type AgentOutcome = {
  /** Le message adressé au créateur, en français courant. */
  reply: string
  /** La spécification obtenue. Identique à celle d'entrée si rien n'a été appliqué. */
  spec: AppSpec
  /** Les opérations retenues, dans l'ordre. Vide quand rien n'a changé. */
  operations: PatchOperation[]
  /** Résumé court pour l'historique des versions. `null` quand rien n'a changé. */
  summary: string | null
  creditsSpent: number
  /** Le solde du créateur après débit. */
  balance: number
  /** Ce que l'agent a lu pour se décider. Affiché au créateur : il a le droit de savoir. */
  read: string[]
  steps: number
  /** Renseigné quand l'agent s'est arrêté sur une borne plutôt que de lui-même. */
  stoppedBy: string | null
}

type Message = Anthropic.Messages.MessageParam

/**
 * Une étape : un appel au modèle, enregistré et facturé.
 *
 * L'enregistrement a lieu même en cas d'échec : une étape qui a consommé des jetons les a
 * consommés, qu'elle ait servi ou non.
 */
async function step(params: {
  client: Anthropic
  system: string
  messages: Message[]
  maxTokens: number
}): Promise<{ response: Anthropic.Messages.Message; costMicros: number; latencyMs: number }> {
  const startedAt = Date.now()
  const response = await params.client.messages.create({
    model: MODELS.fast,
    max_tokens: params.maxTokens,
    // Le prompt système ne varie pas d'une étape à l'autre : il est mis en cache, et
    // l'économie compte d'autant plus qu'une boucle le renvoie à chaque tour.
    system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
    tools: AGENT_TOOLS as unknown as Anthropic.Messages.Tool[],
    messages: params.messages,
  })
  const table = await loadPricing()
  return {
    response,
    costMicros: costMicros(
      MODELS.fast,
      {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedTokens: response.usage.cache_read_input_tokens ?? 0,
      },
      table,
    ),
    latencyMs: Date.now() - startedAt,
  }
}

/** Le texte d'une réponse, blocs de texte concaténés. */
function textOf(response: Anthropic.Messages.Message): string {
  return response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function toolUsesOf(response: Anthropic.Messages.Message): Anthropic.Messages.ToolUseBlock[] {
  return response.content.filter(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
  )
}

export async function runAgent(params: {
  userId: string
  projectId: string
  spec: AppSpec
  request: string
  /**
   * Documents joints à la demande : un cahier des charges, une liste de produits.
   *
   * Ils entrent dans le premier message et y restent : la boucle renvoyant toute la
   * conversation à chaque étape, ils sont mis en cache pour que les étapes suivantes les
   * relisent dix fois moins cher au lieu de les refacturer plein tarif.
   */
  documents?: readonly AttachedDocument[]
  /** Les échanges précédents du projet, du plus ancien au plus récent. Facultatif. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /**
   * Client à solliciter. Par défaut celui d'Evoliia.
   *
   * Il est injectable pour une seule raison, et elle est sérieuse : sans cela, la boucle
   * ne serait éprouvée qu'en production. Les tests lui passent un client qui répond selon
   * un script, ce qui permet de vérifier que les bornes arrêtent vraiment, que le résultat
   * d'un outil revient bien au modèle, et qu'un refus est relu. Aucun appelant du produit
   * ne s'en sert.
   */
  client?: Anthropic
}): Promise<AgentOutcome> {
  if (params.client === undefined && !isAiAvailable()) {
    throw new AppError('AI_UNAVAILABLE', "L'assistant n'est pas configuré sur cette installation.")
  }
  consume(`agent:${params.userId}`, RULES.aiOperation)

  const limits = await loadAgentLimits()
  const budget = newBudget()
  /*
   * Les incidents sont chargés avant la boucle, jamais pendant.
   *
   * Une seule requête, et l'outil qui les rend reste une lecture en mémoire : un outil qui
   * irait chercher en base ferait attendre le modèle au milieu d'une étape déjà payée, et
   * ouvrirait la porte à des outils qui écrivent.
   */
  const workspace: Workspace = newWorkspace(params.spec, await recentIncidents(params.userId))

  const reservation = await reserveCredits({
    userId: params.userId,
    operation: 'edit',
    amount: limits.maxCredits,
    projectId: params.projectId,
  })

  try {
    return await boucle({ ...params, limits, budget, workspace })
  } finally {
    await releaseReservation(reservation.id)
  }
}

async function boucle(params: {
  userId: string
  projectId: string
  spec: AppSpec
  request: string
  documents?: readonly AttachedDocument[] | undefined
  history?: Array<{ role: 'user' | 'assistant'; content: string }> | undefined
  client?: Anthropic | undefined
  limits: AgentLimits
  budget: ReturnType<typeof newBudget>
  workspace: Workspace
}): Promise<AgentOutcome> {
  const { limits, budget, workspace } = params
  const client = params.client ?? getAnthropic()

  const messages: Message[] = [
    ...(params.history ?? []).slice(-6).map((entry) => ({
      role: entry.role,
      content: entry.content.slice(0, 2_000),
    })),
    {
      role: 'user' as const,
      // Les documents précèdent le texte : c'est l'ordre attendu par l'API, et le bon
      // ordre de lecture — le contexte d'abord, la question ensuite.
      content: [
        ...documentBlocks(params.documents ?? []),
        {
          type: 'text' as const,
          text: [
            asUserData('plan_de_lapplication', outline(params.spec)),
            asUserData('demande', params.request),
            "Réponds au créateur quand tu as terminé. N'utilise plus d'outil dans ce dernier message.",
          ].join('\n\n'),
        },
      ],
    },
  ]

  const appels: Array<{ id: string; costMicros: number }> = []
  let reply = ''
  let stoppedBy: string | null = null

  while (true) {
    const verdict = canContinue(budget, limits)
    if (!verdict.ok) {
      stoppedBy = verdict.reason
      break
    }

    let outcome
    try {
      outcome = await step({
        client,
        system: AGENT_SYSTEM,
        messages,
        // La dernière étape autorisée sert à conclure : on lui laisse de quoi écrire une
        // réponse, pas de quoi relancer un chantier.
        maxTokens: 4_000,
      })
    } catch (error) {
      await record(params, 'agent:appel', 0, 0, false, describeFailure(error))
      throw new AppError(
        'AI_UNAVAILABLE',
        "L'assistant est momentanément indisponible. Réessayez dans un instant.",
      )
    }

    budget.steps += 1
    budget.tokens += outcome.response.usage.input_tokens + outcome.response.usage.output_tokens
    const table = await loadPricing()
    budget.credits += creditsFor(outcome.costMicros, 0, table)
    const usageId = await record(
      params,
      'agent:etape',
      outcome.costMicros,
      outcome.latencyMs,
      true,
      undefined,
      outcome.response.usage,
    )
    if (usageId !== null) appels.push({ id: usageId, costMicros: outcome.costMicros })

    const texte = textOf(outcome.response)
    if (texte !== '') reply = texte

    const uses = toolUsesOf(outcome.response)
    if (uses.length === 0) break

    messages.push({ role: 'assistant', content: outcome.response.content })
    messages.push({
      role: 'user',
      content: uses.map((use) => {
        const result = runTool(use.name, use.input, workspace)
        return {
          type: 'tool_result' as const,
          tool_use_id: use.id,
          content: result.text.slice(0, 20_000),
          is_error: result.isError,
        }
      }),
    })
  }

  /*
   * Le plafond s'applique au débit, pas seulement à l'arrêt : une étape qui aurait franchi
   * la borne en cours de route ne doit pas être facturée au-delà de ce qui a été réservé.
   * Le plancher, lui, ne vaut que si quelque chose a réellement changé — une demande à
   * laquelle l'agent répond « ce n'est pas possible » ne se facture pas.
   */
  const credits = Math.max(
    workspace.applied.length > 0 ? MINIMUM_COST.edit : 0,
    Math.min(budget.credits, limits.maxCredits),
  )
  const balance = await spendCredits(params.userId, credits, 'ia:edit', params.projectId, {
    aiUsageId: appels[0]?.id,
  })
  await partager(appels, credits)

  if (reply === '') {
    reply =
      stoppedBy ??
      "Je n'ai pas réussi à formuler de réponse. Reformulez votre demande et je réessaie."
  } else if (stoppedBy !== null) {
    reply = `${reply}\n\n${stoppedBy}`
  }

  logger.info('agent terminé', {
    projectId: params.projectId,
    steps: budget.steps,
    operations: workspace.applied.length,
    stopped: stoppedBy !== null,
  })

  return {
    reply,
    spec: workspace.spec,
    operations: workspace.applied,
    summary: workspace.summaries.at(-1) ?? null,
    creditsSpent: credits,
    balance,
    read: workspace.read,
    steps: budget.steps,
    stoppedBy,
  }
}

/**
 * Inscrit une étape dans la comptabilité fine et rend son identifiant.
 *
 * Un échec d'écriture n'interrompt rien : la comptabilité est précieuse, la modification
 * du créateur l'est davantage.
 */
async function record(
  params: { userId: string; projectId: string },
  operation: string,
  cost: number,
  latencyMs: number,
  success: boolean,
  errorMessage?: string,
  usage?: Anthropic.Messages.Usage,
): Promise<string | null> {
  const row = await prisma.aiUsage
    .create({
      select: { id: true },
      data: {
        userId: params.userId,
        projectId: params.projectId,
        operation,
        model: MODELS.fast,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cachedTokens: usage?.cache_read_input_tokens ?? 0,
        costMicros: cost,
        latencyMs,
        success,
        errorMessage: errorMessage ?? null,
      },
    })
    .catch(() => null)
  return row?.id ?? null
}

/** Répartit les crédits débités entre les étapes, au prorata de leur coût réel. */
async function partager(
  appels: ReadonlyArray<{ id: string; costMicros: number }>,
  credits: number,
): Promise<void> {
  if (appels.length === 0 || credits <= 0) return
  const total = appels.reduce((somme, appel) => somme + appel.costMicros, 0)
  let reste = credits
  for (const [index, appel] of appels.entries()) {
    const part =
      index === appels.length - 1
        ? reste
        : total === 0
          ? Math.floor(credits / appels.length)
          : Math.floor((credits * appel.costMicros) / total)
    reste -= part
    await prisma.aiUsage.update({ where: { id: appel.id }, data: { creditsSpent: part } }).catch(() => undefined)
  }
}
