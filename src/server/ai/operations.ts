import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { ZodType } from 'zod'
import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import {
  creditsForCost,
  ensureCredits,
  spendCredits,
  type CreditedOperation,
} from '@/server/billing/credits'
import { consume, RULES } from '@/server/auth/rate-limit'
import { appSpecSchema, type AppSpec } from '@/server/spec/schema'
import { parseAppSpec } from '@/server/spec/validate'
import { getAnthropic, isAiAvailable } from './client'
import { costMicros, OPERATION_PROFILES } from './routing'
import {
  asUserData,
  BLUEPRINT_SYSTEM,
  EDIT_SYSTEM,
  GENERATE_SYSTEM,
  IDEAS_SYSTEM,
} from './prompts'
import {
  blueprintSchema,
  editResponseSchema,
  ideasSchema,
  type Blueprint,
  type EditResponse,
  type Ideas,
} from './schemas'

/**
 * Opérations de l'assistant.
 *
 * Séquence invariable, dans cet ordre :
 *   1. quota d'appels (protège d'une boucle accidentelle) ;
 *   2. solde de crédits vérifié AVANT tout appel réseau ;
 *   3. appel du modèle avec une sortie structurée ;
 *   4. enregistrement du coût réel observé ;
 *   5. débit des crédits — jamais en cas d'échec.
 */

type RunOptions<T> = {
  operation: CreditedOperation
  userId: string
  projectId?: string
  system: string
  userContent: string
  schema: ZodType<T>
}

type RunResult<T> = { value: T; creditsSpent: number; balance: number }

async function runStructured<T>(options: RunOptions<T>): Promise<RunResult<T>> {
  if (!isAiAvailable()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      "L'assistant n'est pas configuré sur cette installation.",
    )
  }

  consume(`ai:${options.userId}`, RULES.aiOperation)
  await ensureCredits(options.userId, options.operation)

  const profile = OPERATION_PROFILES[options.operation]
  const startedAt = Date.now()

  try {
    const response = await getAnthropic().beta.messages.parse({
      model: profile.model,
      max_tokens: profile.maxTokens,
      system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: options.userContent }],
      output_config: {
        format: betaZodOutputFormat(options.schema),
        effort: profile.effort,
      },
    })

    const latencyMs = Date.now() - startedAt

    if (response.stop_reason === 'refusal') {
      await recordUsage(options, profile.model, response.usage, latencyMs, false, 'refusal')
      throw new AppError(
        'AI_REFUSED',
        "Je ne peux pas créer cette application. Essayez de décrire une autre idée.",
      )
    }

    const parsed = response.parsed_output
    if (parsed === null || parsed === undefined) {
      await recordUsage(options, profile.model, response.usage, latencyMs, false, 'unparsable')
      throw new AppError(
        'AI_UNAVAILABLE',
        "L'assistant n'a pas répondu correctement. Réessayez dans un instant.",
      )
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: response.usage.cache_read_input_tokens ?? 0,
    }
    const cost = costMicros(profile.model, usage)
    const credits = creditsForCost(options.operation, cost)

    await prisma.aiUsage.create({
      data: {
        userId: options.userId,
        projectId: options.projectId ?? null,
        operation: options.operation,
        model: profile.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        costMicros: cost,
        creditsSpent: credits,
        latencyMs,
        success: true,
      },
    })

    const balance = await spendCredits(
      options.userId,
      credits,
      `ia:${options.operation}`,
      options.projectId,
    )

    return { value: parsed as T, creditsSpent: credits, balance }
  } catch (error) {
    if (error instanceof AppError) throw error
    logger.error('appel IA en échec', {
      operation: options.operation,
      userId: options.userId,
      reason: error instanceof Error ? error.message : 'inconnu',
    })
    await prisma.aiUsage
      .create({
        data: {
          userId: options.userId,
          projectId: options.projectId ?? null,
          operation: options.operation,
          model: profile.model,
          latencyMs: Date.now() - startedAt,
          success: false,
          errorCode: 'network',
        },
      })
      .catch(() => undefined)
    throw new AppError(
      'AI_UNAVAILABLE',
      "L'assistant est momentanément indisponible. Réessayez dans un instant.",
    )
  }
}

async function recordUsage(
  options: { userId: string; projectId?: string; operation: CreditedOperation },
  model: string,
  usage: { input_tokens: number; output_tokens: number },
  latencyMs: number,
  success: boolean,
  errorCode: string,
): Promise<void> {
  await prisma.aiUsage
    .create({
      data: {
        userId: options.userId,
        projectId: options.projectId ?? null,
        operation: options.operation,
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        costMicros: costMicros(model, {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedTokens: 0,
        }),
        latencyMs,
        success,
        errorCode,
      },
    })
    .catch(() => undefined)
}

// ───────────────────────────── Opérations publiques ──────────────────────────

export async function generateBlueprint(
  userId: string,
  idea: string,
  locale: string,
): Promise<RunResult<Blueprint>> {
  return runStructured({
    operation: 'blueprint',
    userId,
    system: BLUEPRINT_SYSTEM,
    schema: blueprintSchema,
    userContent: [
      `Langue des textes à produire : ${locale}.`,
      asUserData('idee', idea),
      "Analyse cette idée et propose un plan d'application.",
    ].join('\n\n'),
  })
}

export async function generateSpec(
  userId: string,
  projectId: string,
  blueprint: Blueprint,
  locale: string,
): Promise<RunResult<AppSpec>> {
  const result = await runStructured({
    operation: 'generate',
    userId,
    projectId,
    system: GENERATE_SYSTEM,
    schema: appSpecSchema,
    userContent: [
      `Langue des textes à produire : ${locale}. Le champ "locale" doit valoir "${locale}".`,
      `Le champ "specVersion" doit valoir 1.`,
      asUserData('plan', JSON.stringify(blueprint, null, 2)),
      "Construis la description complète de cette application.",
    ].join('\n\n'),
  })
  // Deuxième filet : cohérence des références internes, que le schéma seul ne couvre pas.
  return { ...result, value: parseAppSpec(result.value) }
}

export async function requestEdit(
  userId: string,
  projectId: string,
  spec: AppSpec,
  request: string,
): Promise<RunResult<EditResponse>> {
  return runStructured({
    operation: 'edit',
    userId,
    projectId,
    system: EDIT_SYSTEM,
    schema: editResponseSchema,
    userContent: [
      asUserData('application_actuelle', JSON.stringify(spec)),
      asUserData('demande', request),
      'Produis les opérations nécessaires pour répondre à cette demande.',
    ].join('\n\n'),
  })
}

export type IdeaProfile = {
  goal: string
  skills: string
  sector: string
  budget: string
  time: string
  country: string
  audience: string
}

export async function suggestIdeas(
  userId: string,
  profile: IdeaProfile,
  locale: string,
): Promise<RunResult<Ideas>> {
  return runStructured({
    operation: 'ideas',
    userId,
    system: IDEAS_SYSTEM,
    schema: ideasSchema,
    userContent: [
      `Langue des textes à produire : ${locale}.`,
      asUserData('profil', JSON.stringify(profile, null, 2)),
      "Propose des idées d'applications adaptées à ce profil.",
    ].join('\n\n'),
  })
}
