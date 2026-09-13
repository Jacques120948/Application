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
import type { AppSpec, Block } from '@/server/spec/schema'
import type { PatchOperation } from '@/server/spec/patch'
import { assembleSpec } from '@/server/spec/assemble'
import { getAnthropic, getAnthropicWithKey, isAiAvailable } from './client'
import { costMicros, GENERATION_STEPS, OPERATION_PROFILES, type ModelId, type TokenUsage } from './routing'
import {
  appAssistantSystem,
  asUserData,
  BLUEPRINT_SYSTEM,
  ANALYTICS_AGENT_SYSTEM,
  COACH_SYSTEM,
  SEO_AGENT_SYSTEM,
  SOCIAL_AGENT_SYSTEM,
  EDIT_SYSTEM,
  GENERATE_PAGE_SYSTEM,
  GENERATE_PLAN_SYSTEM,
  IDEAS_SYSTEM,
  SPECSHEET_SYSTEM,
  VALIDATION_SYSTEM,
} from './prompts'
import {
  appPlanSchema,
  blueprintSchema,
  editResponseSchema,
  ideasSchema,
  pageContentSchema,
  specSheetSchema,
  validationSchema,
  type Blueprint,
  type EditResponse,
  type Ideas,
  type IdeaValidation,
  type SpecSheet,
} from './schemas'

/**
 * Opérations de l'assistant.
 *
 * Séquence invariable :
 *   1. quota d'appels (protège d'une boucle accidentelle) ;
 *   2. solde de crédits vérifié AVANT tout appel réseau ;
 *   3. un ou plusieurs appels du modèle en sortie structurée ;
 *   4. enregistrement du coût réel observé, un enregistrement par appel ;
 *   5. débit des crédits — jamais en cas d'échec.
 */

export type RunResult<T> = { value: T; creditsSpent: number; balance: number }

type CallOutcome<T> = { value: T; usage: TokenUsage; latencyMs: number; model: ModelId }

/**
 * Un appel au modèle, sans comptabilité : c'est l'appelant qui la fait.
 *
 * On ignore volontairement le `parsed_output` du SDK et on valide la réponse nous-mêmes :
 * mesuré contre l'API réelle, ce champ vaut `null` dès que la réponse contient un bloc de
 * réflexion avant le texte, ce qui est le cas par défaut sur les modèles actuels. La
 * validation doit de toute façon passer par notre schéma Zod, qui fait autorité.
 * La contrainte de grammaire, elle, s'applique toujours : le modèle ne peut produire que
 * du JSON conforme au schéma.
 */
async function callStructured<T>(params: {
  model: ModelId
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
  system: string
  userContent: string
  schema: ZodType<T>
}): Promise<CallOutcome<T>> {
  const startedAt = Date.now()

  const response = await getAnthropic().beta.messages.parse({
    model: params.model,
    max_tokens: params.maxTokens,
    // Le prompt système ne varie pas d'un appel à l'autre : il est mis en cache.
    system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: params.userContent }],
    output_config: {
      format: betaZodOutputFormat(params.schema),
      effort: params.effort,
    },
  })

  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedTokens: response.usage.cache_read_input_tokens ?? 0,
  }
  const latencyMs = Date.now() - startedAt
  const details = { usage, latencyMs }

  if (response.stop_reason === 'refusal') {
    throw new AppError(
      'AI_REFUSED',
      "Je ne peux pas créer cette application. Essayez de décrire une autre idée.",
      { details },
    )
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AppError(
      'AI_UNAVAILABLE',
      "La réponse de l'assistant a été interrompue. Réessayez avec une demande plus simple.",
      { details },
    )
  }

  const text = response.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new AppError(
      'AI_UNAVAILABLE',
      "L'assistant n'a pas répondu correctement. Réessayez dans un instant.",
      { details },
    )
  }

  const parsed = parseTolerantly(params.schema, raw)
  if (!parsed.success) {
    logger.warn("réponse de l'assistant non conforme au schéma", {
      model: params.model,
      issue: parsed.issue,
      path: parsed.path,
    })
    throw new AppError(
      'AI_UNAVAILABLE',
      "L'assistant n'a pas répondu correctement. Réessayez dans un instant.",
      { details },
    )
  }

  return { value: parsed.data, usage, latencyMs, model: params.model }
}

/**
 * Valide la réponse, en rattrapant le seul écart qui ne mérite pas de jeter un appel payant :
 * un texte un peu plus long que la borne du schéma.
 *
 * Constat en conditions réelles : une analyse d'idée de quarante secondes a été perdue
 * parce que la conclusion faisait 512 caractères au lieu de 500. La contrainte de
 * grammaire ne fait pas respecter les longueurs ; nos bornes servent à borner le stockage,
 * pas à juger la qualité. On tronque donc, une fois, puis on revalide.
 */
function parseTolerantly<T>(
  schema: ZodType<T>,
  raw: unknown,
): { success: true; data: T } | { success: false; issue?: string; path?: string } {
  const first = schema.safeParse(raw)
  if (first.success) return { success: true, data: first.data }

  const overflows = first.error.issues.filter(
    (issue): issue is typeof issue & { maximum: number | bigint } =>
      issue.code === 'too_big' && issue.origin === 'string',
  )
  if (overflows.length === 0 || overflows.length !== first.error.issues.length) {
    const issue = first.error.issues[0]
    return { success: false, issue: issue?.message, path: issue?.path.join('.') }
  }

  const repaired = structuredClone(raw)
  for (const issue of overflows) {
    const maximum = Number(issue.maximum)
    if (!Number.isFinite(maximum) || maximum <= 1) continue
    truncateAt(repaired, issue.path as Array<string | number>, maximum)
  }

  const second = schema.safeParse(repaired)
  if (second.success) {
    logger.info("réponse de l'assistant tronquée aux bornes du schéma", {
      fields: overflows.map((issue) => issue.path.join('.')),
    })
    return { success: true, data: second.data }
  }
  const issue = second.error.issues[0]
  return { success: false, issue: issue?.message, path: issue?.path.join('.') }
}

function truncateAt(root: unknown, path: Array<string | number>, maximum: number): void {
  const last = path[path.length - 1]
  if (last === undefined) return

  let current: unknown = root
  for (const segment of path.slice(0, -1)) {
    if (typeof current !== 'object' || current === null) return
    current = (current as Record<string | number, unknown>)[segment]
  }
  if (typeof current !== 'object' || current === null) return

  const container = current as Record<string | number, unknown>
  const value = container[last]
  if (typeof value === 'string') container[last] = value.slice(0, maximum).trimEnd()
}

type Accounting = { userId: string; projectId?: string; operation: CreditedOperation }

/**
 * Enregistre un appel et renvoie ce qu'il a coûté à Evoliia.
 *
 * `billedToEvoliia` à faux pour un appel passé sur la clé d'un créateur : les jetons sont
 * comptés, parce qu'ils disent ce qui s'est passé, mais le coût est nul — il n'est pas
 * question de faire figurer dans les dépenses d'Evoliia de l'argent qu'elle n'a pas
 * déboursé.
 */
async function recordCall(
  accounting: Accounting,
  step: string,
  outcome: { model: string; usage: TokenUsage; latencyMs: number },
  success: boolean,
  errorCode?: string,
  billedToEvoliia = true,
): Promise<number> {
  const cost = billedToEvoliia ? costMicros(outcome.model, outcome.usage) : 0
  await prisma.aiUsage
    .create({
      data: {
        userId: accounting.userId,
        projectId: accounting.projectId ?? null,
        operation: step,
        model: outcome.model,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        cachedTokens: outcome.usage.cachedTokens,
        costMicros: cost,
        latencyMs: outcome.latencyMs,
        success,
        errorCode: errorCode ?? null,
      },
    })
    .catch(() => undefined)
  return cost
}

/** Vérifie le quota et le solde. À appeler avant le premier appel réseau. */
async function beforeCalls(accounting: Accounting): Promise<void> {
  if (!isAiAvailable()) {
    throw new AppError('AI_UNAVAILABLE', "L'assistant n'est pas configuré sur cette installation.")
  }
  consume(`ai:${accounting.userId}`, RULES.aiOperation)
  await ensureCredits(accounting.userId, accounting.operation)
}

/** Débite une fois, sur la base du coût cumulé réellement observé. */
async function afterCalls(accounting: Accounting, totalCostMicros: number): Promise<RunResult<null>> {
  const credits = creditsForCost(accounting.operation, totalCostMicros)
  const balance = await spendCredits(
    accounting.userId,
    credits,
    `ia:${accounting.operation}`,
    accounting.projectId,
  )
  return { value: null, creditsSpent: credits, balance }
}

function toPublicFailure(error: unknown, context: Record<string, unknown>): AppError {
  if (error instanceof AppError) return error
  logger.error('appel IA en échec', {
    ...context,
    reason: error instanceof Error ? error.message : 'inconnu',
  })
  return new AppError(
    'AI_UNAVAILABLE',
    "L'assistant est momentanément indisponible. Réessayez dans un instant.",
  )
}

/** Cas courant : une opération = un seul appel. */
async function runSingleCall<T>(params: {
  accounting: Accounting
  system: string
  userContent: string
  schema: ZodType<T>
}): Promise<RunResult<T>> {
  await beforeCalls(params.accounting)
  const profile = OPERATION_PROFILES[params.accounting.operation]

  try {
    const outcome = await callStructured({
      model: profile.model,
      maxTokens: profile.maxTokens,
      effort: profile.effort,
      system: params.system,
      userContent: params.userContent,
      schema: params.schema,
    })
    const cost = await recordCall(params.accounting, params.accounting.operation, outcome, true)
    const spent = await afterCalls(params.accounting, cost)
    return { value: outcome.value, creditsSpent: spent.creditsSpent, balance: spent.balance }
  } catch (error) {
    await recordCall(
      params.accounting,
      params.accounting.operation,
      { model: profile.model, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, latencyMs: 0 },
      false,
      error instanceof AppError ? error.code : 'network',
    )
    throw toPublicFailure(error, { operation: params.accounting.operation })
  }
}

// ───────────────────────────── Opérations publiques ──────────────────────────

export async function generateBlueprint(
  userId: string,
  idea: string,
  locale: string,
): Promise<RunResult<Blueprint>> {
  return runSingleCall({
    accounting: { userId, operation: 'blueprint' },
    system: BLUEPRINT_SYSTEM,
    schema: blueprintSchema,
    userContent: [
      `Langue des textes à produire : ${locale}.`,
      asUserData('idee', idea),
      "Analyse cette idée et propose un plan d'application.",
    ].join('\n\n'),
  })
}

/**
 * Génération complète, en deux temps.
 *
 * Un appel pour le plan, puis un appel par page, lancés en parallèle. Ce découpage est
 * imposé par la taille maximale de la grammaire des sorties structurées, mesurée contre
 * l'API réelle (voir src/server/ai/schemas.ts). Il rend aussi la génération plus robuste :
 * une page en échec ne fait pas perdre l'application entière.
 */
export async function generateSpec(
  userId: string,
  projectId: string,
  blueprint: Blueprint,
  locale: string,
): Promise<RunResult<AppSpec>> {
  const accounting: Accounting = { userId, projectId, operation: 'generate' }
  await beforeCalls(accounting)

  let totalCost = 0

  try {
    const plan = await callStructured({
      ...GENERATION_STEPS.plan,
      system: GENERATE_PLAN_SYSTEM,
      schema: appPlanSchema,
      userContent: [
        `Langue des textes à produire : ${locale}. Le champ "locale" doit valoir "${locale}".`,
        asUserData('plan_valide_par_utilisateur', JSON.stringify(blueprint, null, 2)),
        "Décris la structure de cette application.",
      ].join('\n\n'),
    })
    totalCost += await recordCall(accounting, 'generate:plan', plan, true)

    // Contexte commun à toutes les pages : identique d'un appel à l'autre, donc mis en cache.
    const sharedContext = JSON.stringify({
      application: { name: plan.value.name, tagline: plan.value.tagline, locale },
      modeles_de_donnees: plan.value.dataModels,
      pages: plan.value.pages.map((page) => ({ id: page.id, title: page.title })),
    })

    const results = await Promise.allSettled(
      plan.value.pages.map((page) =>
        callStructured({
          ...GENERATION_STEPS.page,
          system: GENERATE_PAGE_SYSTEM,
          schema: pageContentSchema,
          userContent: [
            `Langue des textes à produire : ${locale}.`,
            asUserData('contexte', sharedContext),
            asUserData('page_a_rediger', JSON.stringify(page, null, 2)),
            'Produis les sections de cette page.',
          ].join('\n\n'),
        }).then((outcome) => ({ pageId: page.id, outcome })),
      ),
    )

    const blocksByPage = new Map<string, Block[]>()
    let failedPages = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        totalCost += await recordCall(accounting, 'generate:page', result.value.outcome, true)
        blocksByPage.set(result.value.pageId, result.value.outcome.value.blocks)
      } else {
        failedPages += 1
        logger.warn('page non générée', { projectId })
      }
    }
    if (blocksByPage.size === 0) {
      throw new AppError('AI_UNAVAILABLE', "L'assistant n'a produit aucune page exploitable.")
    }
    if (failedPages > 0) {
      logger.warn('génération partielle', { projectId, failedPages })
    }

    const spec = assembleSpec({
      name: plan.value.name,
      tagline: plan.value.tagline,
      description: plan.value.description,
      locale: plan.value.locale,
      theme: plan.value.theme,
      auth: plan.value.auth,
      dataModels: plan.value.dataModels,
      navigation: plan.value.navigation,
      monetization: plan.value.monetization,
      pages: plan.value.pages,
      blocksByPage,
    })

    const spent = await afterCalls(accounting, totalCost)
    return { value: spec, creditsSpent: spent.creditsSpent, balance: spent.balance }
  } catch (error) {
    // Les appels déjà faits ont coûté : ils sont facturés même si l'assemblage échoue.
    if (totalCost > 0) await afterCalls(accounting, totalCost).catch(() => undefined)
    throw toPublicFailure(error, { operation: 'generate', projectId })
  }
}

export type EditOperations = {
  supported: boolean
  reply: string
  summary: string
  operations: PatchOperation[]
}

/**
 * Traduit la réponse de l'assistant en opérations de patch.
 *
 * Les valeurs arrivent encodées en JSON dans une chaîne (voir editResponseSchema). Une
 * chaîne illisible rend l'opération inapplicable : on préfère abandonner la modification
 * et le dire, plutôt que d'appliquer un patch partiel.
 */
function toPatchOperations(response: EditResponse): EditOperations {
  const operations: PatchOperation[] = []

  for (const operation of response.operations) {
    if (operation.op === 'delete') {
      operations.push({ op: 'delete', path: operation.path })
      continue
    }
    if (operation.op === 'move') {
      operations.push({ op: 'move', path: operation.path, from: operation.from, to: operation.to })
      continue
    }

    let value: unknown
    try {
      value = JSON.parse(operation.valueJson)
    } catch {
      return {
        supported: false,
        reply:
          "Je n'ai pas réussi à préparer cette modification. Reformulez votre demande et je réessaie.",
        summary: response.summary,
        operations: [],
      }
    }

    if (operation.op === 'insert') {
      operations.push({ op: 'insert', path: operation.path, index: operation.index, value })
    } else {
      operations.push({ op: operation.op, path: operation.path, value })
    }
  }

  return {
    supported: response.supported && operations.length > 0,
    reply: response.reply,
    summary: response.summary,
    operations,
  }
}

/** Contexte d'une tentative précédente refusée par la validation. */
export type FailedAttempt = {
  operations: PatchOperation[]
  problem: string
}

export async function requestEdit(
  userId: string,
  projectId: string,
  spec: AppSpec,
  request: string,
  previous?: FailedAttempt,
): Promise<RunResult<EditOperations>> {
  const result = await runSingleCall({
    accounting: { userId, projectId, operation: 'edit' },
    system: EDIT_SYSTEM,
    schema: editResponseSchema,
    userContent: [
      asUserData('application_actuelle', JSON.stringify(spec)),
      asUserData('demande', request),
      ...(previous === undefined
        ? []
        : [
            [
              'Ta tentative précédente a été refusée par la validation. Corrige-la.',
              `Opérations proposées : ${JSON.stringify(previous.operations)}`,
              `Motif du refus : ${previous.problem}`,
            ].join('\n'),
          ]),
      'Produis les opérations nécessaires pour répondre à cette demande.',
    ].join('\n\n'),
  })
  return { ...result, value: toPatchOperations(result.value) }
}

/** Profil du créateur, tel qu'il est transmis au copilote. */
export type CreatorProfileInput = {
  monthlyGoalCents: number
  weeklyHours: number
  budgetCents: number
  /** Monnaie de tous les montants, code ISO. Les prix proposés doivent s'y conformer. */
  currency: string
  country: string
  skills: string
  interests: string
  sector: string
  audience: string
  ambition: string
  preferredModel: string
}

export async function suggestIdeas(
  userId: string,
  profile: CreatorProfileInput,
  locale: string,
): Promise<RunResult<Ideas>> {
  return runSingleCall({
    accounting: { userId, operation: 'ideas' },
    system: IDEAS_SYSTEM,
    schema: ideasSchema,
    userContent: [
      `Langue des textes à produire : ${locale}.`,
      `Monnaie de tous les montants : ${profile.currency}. Aucune conversion.`,
      asUserData('profil_du_createur', JSON.stringify(profile, null, 2)),
      "Propose des idées d'applications adaptées à ce profil.",
    ].join('\n\n'),
  })
}

/**
 * Cahier des charges du MVP, rédigé à partir de l'idée analysée.
 *
 * Étape 5 du parcours : le créateur lit ce document et l'approuve. Ce n'est pas un second
 * générateur — une fois approuvé, il est traduit en plan d'entrée du moteur existant.
 */
export async function writeSpecSheet(
  userId: string,
  idea: unknown,
  validation: unknown,
  profile: CreatorProfileInput,
  locale: string,
): Promise<RunResult<SpecSheet>> {
  return runSingleCall({
    accounting: { userId, operation: 'specsheet' },
    system: SPECSHEET_SYSTEM,
    schema: specSheetSchema,
    userContent: [
      `Langue des textes à produire : ${locale}.`,
      `Monnaie de tous les montants : ${profile.currency}. Aucune conversion.`,
      asUserData('profil_du_createur', JSON.stringify(profile, null, 2)),
      asUserData('idee', JSON.stringify(idea, null, 2)),
      ...(validation === null ? [] : [asUserData('analyse', JSON.stringify(validation, null, 2))]),
      'Rédige le cahier des charges de la première version.',
    ].join('\n\n'),
  })
}

/** Examen approfondi d'une idée choisie, avant toute construction. */
export async function validateIdea(
  userId: string,
  idea: unknown,
  profile: CreatorProfileInput,
  locale: string,
): Promise<RunResult<IdeaValidation>> {
  return runSingleCall({
    accounting: { userId, operation: 'validate' },
    system: VALIDATION_SYSTEM,
    schema: validationSchema,
    userContent: [
      `Langue des textes à produire : ${locale}.`,
      `Monnaie de tous les montants : ${profile.currency}. Aucune conversion.`,
      asUserData('profil_du_createur', JSON.stringify(profile, null, 2)),
      asUserData('idee_a_examiner', JSON.stringify(idea, null, 2)),
      'Examine cette idée et rends ton verdict.',
    ].join('\n\n'),
  })
}

/**
 * Réponse de l'assistant intégré à une application créée.
 *
 * Différence essentielle avec les autres appels : ce n'est pas le créateur qui écrit, c'est
 * un visiteur de son application. La question est donc traitée comme une donnée, et le coût
 * est débité du portefeuille du créateur — jamais de celui de la plateforme.
 *
 * Appel en texte libre, sans schéma de sortie : on attend une phrase, pas une structure.
 */
export async function answerAsAppAssistant(params: {
  ownerId: string
  projectId: string
  appName: string
  role: string
  question: string
  locale: string
  /**
   * Clé Anthropic du créateur, quand il en a connecté une. L'appel part alors sur son
   * compte : aucun crédit Evoliia n'est débité, et le coût de l'appel pour Evoliia est nul.
   */
  creatorKey?: string | null
}): Promise<{ answer: string; creditsSpent: number; paidByCreatorKey: boolean }> {
  const accounting: Accounting = {
    userId: params.ownerId,
    projectId: params.projectId,
    operation: 'assistant',
  }
  const creatorKey = params.creatorKey ?? null
  const onCreatorKey = creatorKey !== null && creatorKey !== ''

  if (onCreatorKey) {
    /*
     * La clé d'Evoliia n'est pas requise ici, et il n'y a pas de solde à vérifier : le
     * compte sollicité est celui du créateur. Le quota d'appels, lui, reste — il protège
     * d'une boucle, pas d'une facture.
     */
    consume(`ai:${params.ownerId}`, RULES.aiOperation)
  } else {
    await beforeCalls(accounting)
  }

  const profile = OPERATION_PROFILES.assistant
  const startedAt = Date.now()
  const step = onCreatorKey ? 'assistant-cle-createur' : 'assistant'

  try {
    const client = onCreatorKey ? getAnthropicWithKey(creatorKey) : getAnthropic()
    const response = await client.messages.create({
      model: profile.model,
      max_tokens: profile.maxTokens,
      system: [
        {
          type: 'text',
          text: appAssistantSystem({
            appName: params.appName,
            role: params.role,
            locale: params.locale,
          }),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: asUserData('question_du_visiteur', params.question) },
      ],
    })

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: response.usage.cache_read_input_tokens ?? 0,
    }
    const cost = await recordCall(
      accounting,
      step,
      { model: profile.model, usage, latencyMs: Date.now() - startedAt },
      true,
      undefined,
      !onCreatorKey,
    )
    const creditsSpent = onCreatorKey ? 0 : (await afterCalls(accounting, cost)).creditsSpent

    const answer = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    if (answer === '') {
      throw new AppError(
        'AI_REFUSED',
        "L'assistant n'a pas pu répondre à cette question. Reformulez-la.",
      )
    }
    return { answer, creditsSpent, paidByCreatorKey: onCreatorKey }
  } catch (error) {
    await recordCall(
      accounting,
      step,
      {
        model: profile.model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        latencyMs: Date.now() - startedAt,
      },
      false,
      error instanceof AppError ? error.code : 'inconnu',
      false,
    )
    if (onCreatorKey) throw creatorKeyFailure(error)
    throw toPublicFailure(error, { projectId: params.projectId })
  }
}

/**
 * Traduit un refus du compte du créateur.
 *
 * Distinguer « la clé est mauvaise » d'une panne passagère a une conséquence concrète :
 * dans le premier cas l'appelant doit le dire au créateur, dans le second il doit
 * simplement réessayer plus tard. Le message ne cite jamais la clé.
 */
function creatorKeyFailure(error: unknown): AppError {
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : null

  if (status === 401 || status === 403) {
    return new AppError('CREATOR_KEY_REJECTED', 'Anthropic a refusé votre clé.')
  }
  if (status === 402 || status === 429) {
    return new AppError(
      'CREATOR_KEY_REJECTED',
      'Votre compte Anthropic a refusé l’appel : crédit épuisé ou plafond atteint.',
    )
  }
  return toPublicFailure(error, {})
}

/**
 * Réponse du coach qui accompagne le créateur dans Evoliia.
 *
 * L'état du parcours est calculé côté serveur et transmis en donnée : le coach ne le
 * découvre pas de la bouche de la personne, il le lit. C'est ce qui lui permet de ne pas
 * proposer une étape déjà franchie.
 *
 * L'historique est borné à quelques échanges : une conversation qui grossit sans limite
 * ferait grossir la facture de la même façon.
 */
export async function askCoach(params: {
  userId: string
  question: string
  situation: string
  history: Array<{ question: string; answer: string }>
  locale: string
}): Promise<{ answer: string; creditsSpent: number }> {
  const accounting: Accounting = { userId: params.userId, operation: 'coach' }
  await beforeCalls(accounting)
  const profile = OPERATION_PROFILES.coach
  const startedAt = Date.now()

  const messages = [
    ...params.history.slice(-2).flatMap((turn) => [
      { role: 'user' as const, content: asUserData('question', turn.question) },
      { role: 'assistant' as const, content: turn.answer.slice(0, 600) },
    ]),
    {
      role: 'user' as const,
      content: [
        `Langue de la réponse : ${params.locale}.`,
        asUserData('etat_du_parcours', params.situation),
        asUserData('question', params.question),
      ].join('\n\n'),
    },
  ]

  try {
    const response = await getAnthropic().messages.create({
      model: profile.model,
      max_tokens: profile.maxTokens,
      system: [
        { type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages,
    })

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: response.usage.cache_read_input_tokens ?? 0,
    }
    const cost = await recordCall(
      accounting,
      'coach',
      { model: profile.model, usage, latencyMs: Date.now() - startedAt },
      true,
    )
    const spent = await afterCalls(accounting, cost)

    const answer = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    if (answer === '') {
      throw new AppError('AI_REFUSED', "Le coach n'a pas pu répondre. Reformulez votre question.")
    }
    return { answer, creditsSpent: spent.creditsSpent }
  } catch (error) {
    await recordCall(
      accounting,
      'coach',
      {
        model: profile.model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        latencyMs: Date.now() - startedAt,
      },
      false,
      error instanceof AppError ? error.code : 'inconnu',
    )
    throw toPublicFailure(error, { userId: params.userId })
  }
}


/**
 * Question posée à l'un des trois spécialistes marketing.
 *
 * Un seul appel pour les trois : ils ne diffèrent que par leur cadre et par les faits
 * qu'ils reçoivent. Une fonction par métier aurait triplé le même code, et avec lui les
 * trois endroits où oublier de comptabiliser un crédit.
 *
 * La réponse se termine par une ligne « RETENIR: … » que l'on détache ici. Elle n'est pas
 * montrée au créateur : elle sert à ses collègues, à la question suivante. La demander dans
 * la réponse plutôt qu'en un second appel évite de payer deux fois pour une phrase.
 */
export async function askSpecialist(params: {
  userId: string
  agent: 'social' | 'seo' | 'analytics'
  question: string
  facts: string
  teamMemory: string | null
  history: Array<{ question: string; answer: string }>
  locale: string
}): Promise<{ answer: string; takeaway: string | null; creditsSpent: number }> {
  const accounting: Accounting = { userId: params.userId, operation: 'specialist' }
  await beforeCalls(accounting)
  const profile = OPERATION_PROFILES.specialist
  const startedAt = Date.now()

  const system =
    params.agent === 'social'
      ? SOCIAL_AGENT_SYSTEM
      : params.agent === 'seo'
        ? SEO_AGENT_SYSTEM
        : ANALYTICS_AGENT_SYSTEM

  const messages = [
    ...params.history.slice(-2).flatMap((turn) => [
      { role: 'user' as const, content: asUserData('question', turn.question) },
      { role: 'assistant' as const, content: turn.answer.slice(0, 800) },
    ]),
    {
      role: 'user' as const,
      content: [
        `Langue de la réponse : ${params.locale}.`,
        asUserData('faits_du_projet', params.facts),
        params.teamMemory === null
          ? "Tes collègues n'ont encore rien retenu sur ce projet."
          : asUserData('ce_que_tes_collegues_ont_retenu', params.teamMemory),
        asUserData('question', params.question),
      ].join('\n\n'),
    },
  ]

  try {
    const response = await getAnthropic().messages.create({
      model: profile.model,
      max_tokens: profile.maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    })

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: response.usage.cache_read_input_tokens ?? 0,
    }
    const cost = await recordCall(
      accounting,
      'specialist',
      { model: profile.model, usage, latencyMs: Date.now() - startedAt },
      true,
    )
    const spent = await afterCalls(accounting, cost)

    const brut = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    if (brut === '') {
      throw new AppError('AI_REFUSED', "Le spécialiste n'a pas pu répondre. Reformulez votre question.")
    }

    // La ligne « RETENIR: » est optionnelle : une réponse qui l'oublie reste valable, elle
    // ne laisse simplement rien à ses collègues.
    const lignes = brut.split('\n')
    const index = lignes.findIndex((ligne) => /^RETENIR\s*:/i.test(ligne.trim()))
    const takeaway =
      index === -1 ? null : lignes[index]!.replace(/^RETENIR\s*:/i, '').trim().slice(0, 200)
    const answer = (index === -1 ? lignes : lignes.slice(0, index)).join('\n').trim()

    return { answer, takeaway: takeaway === '' ? null : takeaway, creditsSpent: spent.creditsSpent }
  } catch (error) {
    await recordCall(
      accounting,
      'specialist',
      {
        model: profile.model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        latencyMs: Date.now() - startedAt,
      },
      false,
      error instanceof AppError ? error.code : 'inconnu',
    )
    throw toPublicFailure(error, { userId: params.userId })
  }
}
