import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { Prisma, ProjectStatus } from '@prisma/client'
import { AppError, conflict, notFound, validation } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import { requireOwnedProject, withUserScope, type TenantClient } from '@/server/db/scope'
import { getEffectivePlan } from '@/server/billing/plans'
import { isAiAvailable } from '@/server/ai/client'
import { generateBlueprint, generateSpec, requestEdit } from '@/server/ai/operations'
import { blueprintSchema, type Blueprint } from '@/server/ai/schemas'
import { applyPatch, specPatchSchema, type PatchOperation, type SpecPatch } from '@/server/spec/patch'
import { truncationLeak } from '@/server/agent/context'
import { runAgent } from '@/server/agent/loop'
import { planTargets, planVerdict } from '@/server/agent/plan'
import { runChecks, type CheckReport } from '@/server/spec/checks'
import { buildTemplate, THEME_PRESETS, DEFAULT_THEME } from '@/server/spec/templates'
import { parseAppSpec } from '@/server/spec/validate'
import type { AppSpec } from '@/server/spec/schema'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/config'
import { heuristicBlueprint, blueprintFromIdea, blueprintFromSpecSheet } from './blueprints'
import { getIdea } from '@/server/business/ideas'
import { publicAppUrl } from '@/lib/apps-domain'
import { resolveAttachments, type ChatAttachment } from '@/server/media/service'
import {
  assertDocumentsFit,
  documentBrief,
  type AttachedDocument,
} from '@/server/ai/documents'
import { getAnthropic } from '@/server/ai/client'
import { MODELS } from '@/server/ai/routing'

/**
 * Cas d'usage « projet ».
 *
 * Aucune dépendance à HTTP : les routes se contentent de valider l'entrée et d'appeler
 * ces fonctions. Toute lecture ou écriture passe par une portée de locataire.
 *
 * Règle importante : les appels IA sont faits HORS transaction. Une transaction ouverte
 * ne doit jamais attendre un tiers.
 */

export const ideaInput = z.object({
  idea: z.string().trim().min(10, 'Décrivez votre idée en quelques mots de plus.').max(2000),
  locale: z.enum(SUPPORTED_LOCALES).default('fr'),
})

export type AnalysedIdea = {
  blueprint: Blueprint
  source: 'assistant' | 'modele-de-depart'
  creditsSpent: number
}

/** Étape 2 du parcours : proposer un plan avant de construire quoi que ce soit. */
export async function analyseIdea(
  userId: string,
  input: z.infer<typeof ideaInput>,
): Promise<AnalysedIdea> {
  await assertCanCreateProject(userId)

  if (!isAiAvailable()) {
    return { blueprint: heuristicBlueprint(input.idea), source: 'modele-de-depart', creditsSpent: 0 }
  }
  const result = await generateBlueprint(userId, input.idea, input.locale)
  return { blueprint: result.value, source: 'assistant', creditsSpent: result.creditsSpent }
}

export const createProjectInput = z.object({
  idea: z.string().trim().min(10).max(2000),
  locale: z.enum(SUPPORTED_LOCALES).default('fr'),
  blueprint: blueprintSchema,
})

export type CreatedProject = {
  projectId: string
  slug: string
  source: 'assistant' | 'modele-de-depart'
  creditsSpent: number
}

/** Étape 4 du parcours : construire réellement l'application et figer la version 1. */
export async function createProject(
  userId: string,
  input: z.infer<typeof createProjectInput>,
): Promise<CreatedProject> {
  await assertCanCreateProject(userId)

  const blueprint = input.blueprint
  if (!blueprint.feasible) {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      "Cette idée demande des fonctions que la plateforme ne sait pas encore construire.",
      { details: { limitations: blueprint.limitations } },
    )
  }

  const theme = THEME_PRESETS[blueprint.themePreset] ?? DEFAULT_THEME
  const fallbackSpec = buildTemplate(blueprint.templateKind, {
    name: blueprint.appName,
    tagline: blueprint.tagline,
    description: blueprint.description,
    locale: input.locale,
    theme,
  })

  const projectId = crypto.randomUUID()
  let spec = fallbackSpec
  let source: CreatedProject['source'] = 'modele-de-depart'
  let creditsSpent = 0

  if (isAiAvailable()) {
    try {
      const generated = await generateSpec(userId, projectId, blueprint, input.locale)
      spec = generated.value
      source = 'assistant'
      creditsSpent = generated.creditsSpent
    } catch (error) {
      // L'utilisateur obtient tout de même une application fonctionnelle, et on le lui dit.
      logger.warn("génération assistée en échec, repli sur le modèle de départ", {
        userId,
        reason: error instanceof Error ? error.message : 'inconnu',
      })
    }
  }

  let slug = candidateSlug(spec.name)
  for (let attempt = 0; ; attempt += 1) {
    try {
      await withUserScope(userId, async (tx) => {
        await tx.project.create({
          data: {
            id: projectId,
            ownerId: userId,
            name: spec.name,
            slug,
            locale: input.locale,
            idea: input.idea,
            blueprint: blueprint as unknown as Prisma.InputJsonValue,
            draftSpec: spec as unknown as Prisma.InputJsonValue,
            status: 'DRAFT',
          },
        })
        await createVersion(tx, projectId, spec, 'Première version', 'AI')
      })
      break
    } catch (error) {
      if (attempt >= 4 || !isSlugCollision(error)) {
        if (isSlugCollision(error)) {
          throw conflict("Impossible de réserver une adresse pour cette application. Réessayez.")
        }
        throw error
      }
      slug = candidateSlug(spec.name)
    }
  }

  logger.info('projet créé', { userId, projectId, source })
  return { projectId, slug, source, creditsSpent }
}

/**
 * Construction depuis le parcours guidé.
 *
 * Le moteur de génération n'est pas modifié : on lui fournit simplement son plan d'entrée
 * habituel, dérivé du cahier des charges approuvé quand il existe, de l'idée analysée
 * sinon. On ne redemande jamais au copilote de reformuler un plan qu'il vient de produire :
 * cela coûterait un appel et risquerait de contredire ce que le créateur a lu et approuvé.
 */
export async function createProjectFromIdea(
  userId: string,
  ideaId: string,
  locale: Locale,
): Promise<CreatedProject> {
  await assertCanCreateProject(userId)
  const idea = await getIdea(userId, ideaId)

  if (idea.projectId !== null) {
    throw conflict('Une application a déjà été créée à partir de cette idée.')
  }

  // Le cahier des charges est l'étape que le créateur lit et approuve. On ne construit
  // pas sans lui : l'idée seule décrit une intention, pas ce qui sera livré.
  const blueprint =
    idea.specSheet === null ? blueprintFromIdea(idea) : blueprintFromSpecSheet(idea.specSheet)

  const created = await createProject(userId, {
    idea: `${idea.title}. ${idea.problem}`.slice(0, 2000),
    locale,
    blueprint,
  })

  await withUserScope(userId, async (tx) => {
    await tx.idea.update({ where: { id: ideaId }, data: { status: 'SELECTED' } })
    await tx.project.update({ where: { id: created.projectId }, data: { ideaId } })
  })

  return created
}

export type ProjectSummary = {
  id: string
  name: string
  slug: string
  status: ProjectStatus
  updatedAt: Date
  publishedAt: Date | null
  readyScore: number | null
  themeColor: string
  themeAccent: string
  tagline: string
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  return withUserScope(userId, async (tx) => {
    const projects = await tx.project.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      status: project.status,
      updatedAt: project.updatedAt,
      publishedAt: project.publishedAt,
      readyScore: project.lastCheckScore,
      ...readIdentity(project.draftSpec),
    }))
  })
}

export type ProjectDetail = {
  id: string
  name: string
  slug: string
  status: ProjectStatus
  locale: Locale
  idea: string
  spec: AppSpec
  blueprint: Blueprint | null
  publishedAt: Date | null
  publishedVersionId: string | null
  report: CheckReport
  /** Vrai si un test a déjà été lancé sur ce projet : la progression survit au rechargement. */
  hasBeenTested: boolean
}

export async function getProject(userId: string, projectId: string): Promise<ProjectDetail> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const spec = parseAppSpec(project.draftSpec)
    const blueprint = blueprintSchema.safeParse(project.blueprint)
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      status: project.status,
      locale: project.locale as Locale,
      idea: project.idea,
      spec,
      blueprint: blueprint.success ? blueprint.data : null,
      publishedAt: project.publishedAt,
      publishedVersionId: project.publishedVersionId,
      report: runChecks(spec),
      hasBeenTested: project.lastCheckScore !== null,
    }
  })
}

export type EditOutcome = {
  reply: string
  applied: boolean
  summary: string | null
  spec: AppSpec
  creditsSpent: number
  versionNumber: number | null
}

/** Étape 6 du parcours : modifier l'application en langage naturel. */

/**
 * Ce qu'une image jointe ajoute à la demande.
 *
 * Deux textes, et la distinction n'est pas cosmétique.
 *
 * **Ce qui est gardé dans la conversation** ne porte que les noms de fichiers. Un créateur
 * qui relit son historique doit reconnaître ce qu'il a joint, pas déchiffrer des
 * identifiants.
 *
 * **Ce qui part à l'assistant** porte les identifiants, puisque c'est avec eux qu'il place
 * une image, et une consigne sans ambiguïté : il ne voit pas ces images. Il reçoit un nom
 * de fichier et des dimensions, rien de plus. Lui envoyer l'image elle-même serait un appel
 * d'un autre genre, et d'un autre prix — ce n'est pas ce qui est fait ici, et l'assistant
 * doit donc éviter de laisser croire qu'il l'a regardée.
 */
function mentionAttachments(
  attachments: readonly ChatAttachment[],
  documents: readonly AttachedDocument[] = [],
): string {
  const morceaux: string[] = []
  if (attachments.length > 0) {
    const pluriel = attachments.length > 1 ? 's' : ''
    morceaux.push(`Image${pluriel} jointe${pluriel} : ${attachments.map((image) => image.filename).join(', ')}`)
  }
  if (documents.length > 0) {
    const pluriel = documents.length > 1 ? 's' : ''
    morceaux.push(`Document${pluriel} joint${pluriel} : ${documents.map((doc) => doc.filename).join(', ')}`)
  }
  return morceaux.length === 0 ? '' : `\n\n(${morceaux.join(' — ')})`
}

/**
 * Prépare ce qui accompagne une demande.
 *
 * Le comptage des documents a lieu ici, avant toute écriture : un document trop gros doit
 * être refusé sans avoir rien laissé dans la conversation, et sans avoir rien dépensé. Le
 * comptage lui-même est gratuit.
 */
async function prepareRequest(params: {
  userId: string
  projectId: string
  message: string
  mediaIds: readonly string[]
  documents: readonly AttachedDocument[]
}): Promise<{ garde: string; demande: string; documents: readonly AttachedDocument[] }> {
  const attachments = await resolveAttachments(params.userId, params.projectId, params.mediaIds)
  // Sans assistant configuré, il n'y a rien à compter et rien à dépenser : la demande
  // s'arrêtera plus loin avec le message qui convient, pas sur une erreur de client absent.
  if (params.documents.length > 0 && isAiAvailable()) {
    await assertDocumentsFit({
      client: getAnthropic(),
      model: MODELS.fast,
      documents: params.documents,
    })
  }
  const garde = params.message + mentionAttachments(attachments, params.documents)
  return {
    garde,
    demande: garde + briefAttachments(attachments) + documentBrief(params.documents),
    documents: params.documents,
  }
}

function briefAttachments(attachments: readonly ChatAttachment[]): string {
  if (attachments.length === 0) return ''
  const lignes = attachments.map(
    (image) => `- "${image.filename}" (${image.width}x${image.height}) : imageId ${image.id}`,
  )
  return [
    '',
    '',
    'Images jointes à cette demande, déjà enregistrées dans la bibliothèque du projet :',
    ...lignes,
    '',
    'Place-les en renseignant le champ "imageId" du bloc qui convient — bandeau, image et',
    'texte, galerie, portrait d\'équipe, logo. Tu ne les as pas regardées : tu n\'en connais',
    'que le nom et les dimensions. Ne décris jamais leur contenu et n\'invente pas de',
    'légende qui prétendrait le connaître ; si la demande ne dit pas où les mettre,',
    'demande-le.',
  ].join('\n')
}

export async function editWithAssistant(
  userId: string,
  projectId: string,
  message: string,
  mediaIds: readonly string[] = [],
  joints: readonly AttachedDocument[] = [],
): Promise<EditOutcome> {
  const trimmed = message.trim()
  if (trimmed.length < 3) throw validation('Dites en quelques mots ce que vous voulez changer.')
  if (trimmed.length > 2000) throw validation('Votre message est trop long.')

  const { garde, demande, documents } = await prepareRequest({
    userId,
    projectId,
    message: trimmed,
    mediaIds,
    documents: joints,
  })

  const current = await withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    await tx.chatMessage.create({
      data: { projectId, userId, role: 'USER', content: garde },
    })
    return parseAppSpec(project.draftSpec)
  })

  if (!isAiAvailable()) {
    const reply =
      "L'assistant n'est pas configuré sur cette installation. Vous pouvez tout de même modifier votre application depuis l'onglet Design."
    await recordAssistantMessage(userId, projectId, reply, null)
    return { reply, applied: false, summary: null, spec: current, creditsSpent: 0, versionNumber: null }
  }

  // Une tentative, puis une seule reprise si la validation refuse le patch. La reprise
  // reçoit le motif exact du refus : mesurée en conditions réelles, elle rattrape les
  // erreurs de forme que l'assistant corrige dès qu'on les lui nomme.
  let result = await requestEdit(userId, projectId, current, demande, undefined, documents)
  let creditsSpent = result.creditsSpent
  let response = result.value
  let patch: SpecPatch | null = null
  let updated: AppSpec | null = null
  let lastProblem = ''

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!response.supported || response.operations.length === 0) break

    try {
      // Le contrat de sortie de l'assistant est plus permissif que le moteur de patch.
      // C'est ici que la forme est resserrée.
      patch = specPatchSchema.parse({
        summary: response.summary,
        operations: response.operations,
      })
      /*
       * L'assistant ne voit pas toujours les textes longs en entier (voir
       * `agent/context.ts`). S'il en recopie un, il le recopierait coupé : on refuse, et
       * la reprise lui montre l'application entière.
       */
      const fuite = truncationLeak(current, patch.operations)
      if (fuite !== null) throw validation(fuite)
      updated = applyPatch(current, patch)
      break
    } catch (error) {
      patch = null
      lastProblem = describeFailure(error)
      logger.warn('patch rejeté', {
        projectId,
        attempt: attempt + 1,
        reason: lastProblem,
        operations: response.operations.map((operation) => `${operation.op} ${operation.path}`),
      })
      if (attempt === 1) break

      const retry = await requestEdit(
        userId,
        projectId,
        current,
        demande,
        { operations: response.operations, problem: lastProblem },
        documents,
      )
      creditsSpent += retry.creditsSpent
      response = retry.value
    }
  }

  if (!response.supported || response.operations.length === 0) {
    await recordAssistantMessage(userId, projectId, response.reply, null)
    return {
      reply: response.reply,
      applied: false,
      summary: null,
      spec: current,
      creditsSpent,
      versionNumber: null,
    }
  }

  if (patch === null || updated === null) {
    const reply =
      "Je n'ai pas réussi à appliquer cette modification sans casser votre application. Rien n'a été changé. Reformulez votre demande et je réessaie."
    await recordAssistantMessage(userId, projectId, reply, null)
    return {
      reply,
      applied: false,
      summary: null,
      spec: current,
      creditsSpent,
      versionNumber: null,
    }
  }

  const appliedSpec = updated
  const appliedPatch = patch

  const versionNumber = await withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    const version = await createVersion(tx, projectId, appliedSpec, appliedPatch.summary, 'AI')
    await tx.project.update({
      where: { id: projectId },
      data: {
        draftSpec: appliedSpec as unknown as Prisma.InputJsonValue,
        name: appliedSpec.name,
        status: 'TESTING',
      },
    })
    await tx.chatMessage.create({
      data: {
        projectId,
        role: 'ASSISTANT',
        content: response.reply,
        operation: 'edit',
        versionId: version.id,
      },
    })
    return version.number
  })

  return {
    reply: response.reply,
    applied: true,
    summary: appliedPatch.summary,
    spec: appliedSpec,
    creditsSpent,
    versionNumber,
  }
}

/**
 * Étape 6 bis : modifier l'application avec l'agent, en plusieurs étapes.
 *
 * Deux chemins cohabitent volontairement. `editWithAssistant` traduit une demande en un
 * patch, d'un seul coup ; celui-ci laisse l'agent regarder l'application avant de décider,
 * corriger ses propres erreurs et enchaîner plusieurs modifications. Le second ne remplace
 * le premier que le jour où il fait mieux, mesuré — d'ici là, l'interrupteur
 * « appBuilder » décide lequel répond, et le fermer suffit à revenir en arrière.
 *
 * Ce qui est commun aux deux, et ne changera pas : rien n'est écrit tant que la
 * spécification obtenue n'est pas valide, et chaque modification crée une version. Une
 * demande ratée ne coûte donc jamais l'application.
 */
/** Une modification préparée, en attente de la décision du créateur. */
export type PendingPlan = {
  request: string
  summary: string
  operations: PatchOperation[]
  reasons: string[]
  targets: string[]
  scale: { operations: number; pages: number; models: number; deletions: number }
}

/** Ce que le navigateur reçoit d'un plan : de quoi l'afficher, jamais les opérations. */
export type PlanView = {
  id: string
  summary: string
  reasons: string[]
  targets: string[]
  scale: PendingPlan['scale']
}

export type AgentOutcomeView = EditOutcome & {
  read: string[]
  steps: number
  /** Présent quand la modification attend une confirmation. */
  plan?: PlanView
}

/** Empreinte d'un brouillon : dit si le projet a changé depuis qu'un plan a été calculé. */
function empreinteSpec(spec: AppSpec): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex')
}

export async function editWithAgent(
  userId: string,
  projectId: string,
  message: string,
  mediaIds: readonly string[] = [],
  joints: readonly AttachedDocument[] = [],
): Promise<AgentOutcomeView> {
  const trimmed = message.trim()
  if (trimmed.length < 3) throw validation('Dites en quelques mots ce que vous voulez changer.')
  if (trimmed.length > 2000) throw validation('Votre message est trop long.')

  const { garde, demande, documents } = await prepareRequest({
    userId,
    projectId,
    message: trimmed,
    mediaIds,
    documents: joints,
  })

  const { spec: current, history } = await withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    await tx.chatMessage.create({ data: { projectId, userId, role: 'USER', content: garde } })
    const previous = await tx.chatMessage.findMany({
      where: { projectId, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take: 7,
      select: { role: true, content: true },
    })
    return {
      spec: parseAppSpec(project.draftSpec),
      // Le message qu'on vient d'écrire est déjà dans la demande : on ne le répète pas.
      history: previous
        .slice(1)
        .reverse()
        .map((entry) => ({
          role: entry.role === 'USER' ? ('user' as const) : ('assistant' as const),
          content: entry.content,
        })),
    }
  })

  const outcome = await runAgent({
    userId,
    projectId,
    spec: current,
    request: demande,
    documents,
    history,
  })

  if (outcome.operations.length === 0) {
    await recordAssistantMessage(userId, projectId, outcome.reply, null)
    return {
      reply: outcome.reply,
      applied: false,
      summary: null,
      spec: current,
      creditsSpent: outcome.creditsSpent,
      versionNumber: null,
      read: outcome.read,
      steps: outcome.steps,
    }
  }

  const label = outcome.summary ?? 'Modification par l’agent'
  const appliedSpec = outcome.spec

  /*
   * Une modification qui engage est annoncée avant d'être appliquée. Le travail est déjà
   * fait et déjà validé — il attend simplement dans la conversation. C'est délibéré : un
   * plan calculé d'avance serait une intention, que rien ne garantit réalisable, alors que
   * celui-ci est une modification prête, dont on connaît l'ampleur exacte.
   */
  const verdict = planVerdict(outcome.operations)
  if (verdict.required) {
    const plan: PendingPlan = {
      // La demande gardée avec le plan est celle qui a produit ces opérations, consigne
      // sur les images comprise : la reprendre à l'identique doit donner le même résultat.
      request: demande,
      summary: label,
      operations: outcome.operations,
      reasons: verdict.reasons,
      targets: planTargets(current, outcome.operations),
      scale: verdict.scale,
    }
    const messageId = await withUserScope(userId, async (tx) => {
      await requireOwnedProject(tx, projectId, userId)
      // Une proposition en remplace une autre : deux plans en attente sur le même projet
      // se contrediraient, et le second s'appliquerait sur un brouillon que le premier
      // aurait changé.
      await tx.chatMessage.updateMany({
        where: { projectId, planStatus: 'PROPOSED' },
        data: { planStatus: 'STALE' },
      })
      const message = await tx.chatMessage.create({
        data: {
          projectId,
          role: 'ASSISTANT',
          content: outcome.reply,
          operation: 'agent',
          plan: plan as unknown as Prisma.InputJsonValue,
          planStatus: 'PROPOSED',
          planBase: empreinteSpec(current),
        },
        select: { id: true },
      })
      return message.id
    })

    return {
      reply: outcome.reply,
      applied: false,
      summary: label,
      spec: current,
      creditsSpent: outcome.creditsSpent,
      versionNumber: null,
      read: outcome.read,
      steps: outcome.steps,
      plan: { id: messageId, summary: label, reasons: verdict.reasons, targets: plan.targets, scale: verdict.scale },
    }
  }

  const versionNumber = await withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    const version = await createVersion(tx, projectId, appliedSpec, label, 'AI')
    await tx.project.update({
      where: { id: projectId },
      data: {
        draftSpec: appliedSpec as unknown as Prisma.InputJsonValue,
        name: appliedSpec.name,
        status: 'TESTING',
      },
    })
    await tx.chatMessage.create({
      data: {
        projectId,
        role: 'ASSISTANT',
        content: outcome.reply,
        operation: 'agent',
        versionId: version.id,
      },
    })
    return version.number
  })

  return {
    reply: outcome.reply,
    applied: true,
    summary: label,
    spec: appliedSpec,
    creditsSpent: outcome.creditsSpent,
    versionNumber,
    read: outcome.read,
    steps: outcome.steps,
  }
}

/**
 * Applique une modification annoncée, ou l'abandonne.
 *
 * Trois garanties, et aucune n'est superflue.
 *
 * **Le plan est rejoué, pas recopié.** Les opérations sont réappliquées sur le brouillon
 * du moment et revalidées entièrement. Si le résultat n'est plus une application valide,
 * rien n'est écrit : le plan a été calculé plus tôt, et le monde a pu bouger.
 *
 * **Un brouillon qui a changé rend le plan caduc.** L'empreinte enregistrée au moment de
 * la proposition est comparée à celle du brouillon courant. Appliquer à l'aveugle un plan
 * calculé sur une version précédente écraserait silencieusement ce qui a été fait entre
 * les deux.
 *
 * **Aucun crédit n'est débité.** Le travail du modèle a été payé quand il a été fait.
 * Cliquer « Appliquer » ne fait que poser sur le projet ce qui attendait déjà.
 */
export async function decidePlan(
  userId: string,
  projectId: string,
  messageId: string,
  action: 'apply' | 'cancel',
): Promise<{ applied: boolean; reply: string; spec: AppSpec | null; versionNumber: number | null }> {
  const { message, current } = await withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const found = await tx.chatMessage.findFirst({
      where: { id: messageId, projectId },
      select: { id: true, plan: true, planStatus: true, planBase: true },
    })
    if (found === null) throw notFound("Cette proposition n'existe pas.")
    return { message: found, current: parseAppSpec(project.draftSpec) }
  })

  if (message.planStatus !== 'PROPOSED') {
    throw validation("Cette proposition n'est plus en attente.")
  }

  if (action === 'cancel') {
    await withUserScope(userId, async (tx) => {
      await requireOwnedProject(tx, projectId, userId)
      await tx.chatMessage.updateMany({
        where: { id: messageId, projectId, planStatus: 'PROPOSED' },
        data: { planStatus: 'CANCELLED' },
      })
    })
    return {
      applied: false,
      reply: "Modification abandonnée. Votre application n'a pas changé.",
      spec: null,
      versionNumber: null,
    }
  }

  const plan = message.plan as unknown as PendingPlan | null
  if (plan === null || !Array.isArray(plan.operations) || plan.operations.length === 0) {
    throw validation('Cette proposition est illisible. Reformulez votre demande.')
  }

  if (message.planBase !== empreinteSpec(current)) {
    await withUserScope(userId, async (tx) => {
      await requireOwnedProject(tx, projectId, userId)
      await tx.chatMessage.updateMany({
        where: { id: messageId, projectId, planStatus: 'PROPOSED' },
        data: { planStatus: 'STALE' },
      })
    })
    throw conflict(
      'Votre application a changé depuis cette proposition. Redemandez la modification pour que je la recalcule.',
    )
  }

  let updated: AppSpec
  try {
    updated = applyPatch(current, specPatchSchema.parse({
      summary: plan.summary,
      operations: plan.operations,
    }))
  } catch {
    await withUserScope(userId, async (tx) => {
      await requireOwnedProject(tx, projectId, userId)
      await tx.chatMessage.updateMany({
        where: { id: messageId, projectId, planStatus: 'PROPOSED' },
        data: { planStatus: 'STALE' },
      })
    })
    throw validation(
      "Cette modification ne s'applique plus à votre application. Redemandez-la et je la recalcule.",
    )
  }

  const versionNumber = await withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    const version = await createVersion(tx, projectId, updated, plan.summary, 'AI')
    await tx.project.update({
      where: { id: projectId },
      data: {
        draftSpec: updated as unknown as Prisma.InputJsonValue,
        name: updated.name,
        status: 'TESTING',
      },
    })
    await tx.chatMessage.updateMany({
      where: { id: messageId, projectId, planStatus: 'PROPOSED' },
      data: { planStatus: 'APPLIED', versionId: version.id },
    })
    return version.number
  })

  logger.info('plan appliqué', { projectId, operations: plan.operations.length, versionNumber })
  return {
    applied: true,
    reply: `C'est appliqué. Version ${versionNumber} : ${plan.summary}`,
    spec: updated,
    versionNumber,
  }
}

/** Motif de refus, lisible par l'assistant lors de la reprise. */
function describeFailure(error: unknown): string {
  if (error instanceof AppError) {
    const issues = (error.details as { issues?: Array<{ path: string; message: string }> })?.issues
    if (Array.isArray(issues) && issues.length > 0) {
      return issues
        .slice(0, 5)
        .map((issue) => `${issue.path} : ${issue.message}`)
        .join(' ; ')
    }
    return error.message
  }
  return error instanceof Error ? error.message : 'inconnu'
}

/**
 * Modification directe, sans IA et sans crédit (exigence 7 : éditeur visuel).
 * Même moteur de patch, donc mêmes garanties de validation.
 */
export async function applyManualPatch(
  userId: string,
  projectId: string,
  patch: SpecPatch,
): Promise<{ spec: AppSpec; versionNumber: number }> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const updated = applyPatch(parseAppSpec(project.draftSpec), patch)
    const version = await createVersion(tx, projectId, updated, patch.summary, 'USER')
    await tx.project.update({
      where: { id: projectId },
      data: {
        draftSpec: updated as unknown as Prisma.InputJsonValue,
        name: updated.name,
      },
    })
    return { spec: updated, versionNumber: version.number }
  })
}

export type VersionSummary = {
  id: string
  number: number
  label: string
  source: string
  createdAt: Date
  isCurrent: boolean
  isPublished: boolean
}

export async function listVersions(userId: string, projectId: string): Promise<VersionSummary[]> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const versions = await tx.projectVersion.findMany({
      where: { projectId },
      orderBy: { number: 'desc' },
      take: 100,
    })
    const currentJson = JSON.stringify(project.draftSpec)
    return versions.map((version) => ({
      id: version.id,
      number: version.number,
      label: version.label,
      source: version.source,
      createdAt: version.createdAt,
      isCurrent: JSON.stringify(version.spec) === currentJson,
      isPublished: version.id === project.publishedVersionId,
    }))
  })
}

/**
 * Restauration (exigence 19). L'historique n'est jamais réécrit : restaurer crée une
 * nouvelle version dont le contenu est celui d'une version antérieure.
 */
export async function restoreVersion(
  userId: string,
  projectId: string,
  versionId: string,
): Promise<{ spec: AppSpec; versionNumber: number }> {
  return withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    const source = await tx.projectVersion.findFirst({ where: { id: versionId, projectId } })
    if (!source) throw notFound('Cette version est introuvable.')

    const spec = parseAppSpec(source.spec)
    const version = await createVersion(
      tx,
      projectId,
      spec,
      `Retour à la version ${source.number}`,
      'RESTORE',
    )
    await tx.project.update({
      where: { id: projectId },
      data: { draftSpec: spec as unknown as Prisma.InputJsonValue, name: spec.name },
    })
    return { spec, versionNumber: version.number }
  })
}

export async function runProjectChecks(
  userId: string,
  projectId: string,
): Promise<CheckReport> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const report = runChecks(parseAppSpec(project.draftSpec))
    await tx.projectCheck.create({
      data: { projectId, score: report.score, results: report.results as unknown as Prisma.InputJsonValue },
    })
    await tx.project.update({
      where: { id: projectId },
      data: {
        lastCheckScore: report.score,
        status: project.status === 'DRAFT' ? 'TESTING' : project.status,
      },
    })
    return report
  })
}

export type PublishResult = { url: string; versionNumber: number; report: CheckReport }

/** Étape 7 : publier. Publier sert la version figée, jamais le brouillon. */
export async function publishProject(userId: string, projectId: string): Promise<PublishResult> {
  return withUserScope(userId, async (tx) => {
    const project = await requireOwnedProject(tx, projectId, userId)
    const spec = parseAppSpec(project.draftSpec)
    const report = runChecks(spec)

    if (report.counts.error > 0) {
      const blocking = report.results.find((result) => result.status === 'error')
      throw new AppError('VALIDATION', 'Votre application a encore un point bloquant.', {
        details: { blocking, report },
      })
    }

    const version = await createVersion(tx, projectId, spec, 'Publication', 'USER')
    await tx.project.update({
      where: { id: projectId },
      data: {
        status: 'PUBLISHED',
        publishedVersionId: version.id,
        publishedAt: new Date(),
        lastCheckScore: report.score,
      },
    })

    return {
      url: publicAppUrl(project.slug),
      versionNumber: version.number,
      report,
    }
  })
}

/**
 * La conversation d'un projet, avec la proposition en attente s'il y en a une.
 *
 * Une proposition doit survivre à un rechargement de page : le créateur qui ferme son
 * onglet pour aller réfléchir doit retrouver le bouton « Appliquer » en revenant, pas une
 * réponse sans suite dont il ne saurait plus quoi faire.
 */
export async function listChatMessages(userId: string, projectId: string) {
  return withUserScope(userId, async (tx) => {
    await requireOwnedProject(tx, projectId, userId)
    const rows = await tx.chatMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        plan: true,
        planStatus: true,
      },
    })
    return rows.map(({ plan, planStatus, ...message }) => {
      // Les opérations ne sortent jamais vers le navigateur : elles ne lui servent à rien,
      // et c'est le serveur qui les rejouera.
      const attente = planStatus === 'PROPOSED' ? (plan as unknown as PendingPlan | null) : null
      return {
        ...message,
        ...(attente === null
          ? {}
          : {
              plan: {
                id: message.id,
                summary: attente.summary,
                reasons: attente.reasons,
                targets: attente.targets,
                scale: attente.scale,
              } satisfies PlanView,
            }),
      }
    })
  })
}

// ────────────────────────────────── Internes ─────────────────────────────────

async function createVersion(
  tx: TenantClient,
  projectId: string,
  spec: AppSpec,
  label: string,
  source: 'AI' | 'USER' | 'RESTORE',
) {
  const last = await tx.projectVersion.findFirst({
    where: { projectId },
    orderBy: { number: 'desc' },
    select: { number: true },
  })
  return tx.projectVersion.create({
    data: {
      projectId,
      number: (last?.number ?? 0) + 1,
      label: label.slice(0, 120),
      spec: spec as unknown as Prisma.InputJsonValue,
      source,
    },
  })
}

async function recordAssistantMessage(
  userId: string,
  projectId: string,
  content: string,
  versionId: string | null,
): Promise<void> {
  await withUserScope(userId, async (tx) => {
    await tx.chatMessage.create({
      data: { projectId, role: 'ASSISTANT', content, versionId },
    })
  })
}

async function assertCanCreateProject(userId: string): Promise<void> {
  const plan = await getEffectivePlan(userId)

  // L'offre de découverte va jusqu'au bout de la réflexion — objectif, idées, analyse —
  // puis s'arrête avant la construction. C'est le moment où l'abonnement a du sens.
  if (!plan.allowBuild || plan.maxProjects === 0) {
    throw new AppError(
      'PLAN_LIMIT',
      "Votre offre actuelle permet de chercher et d'analyser des idées. Pour construire votre application, choisissez une formule.",
      { details: { planId: plan.id, reason: 'build' } },
    )
  }

  // Le comptage DOIT se faire dans la portée du créateur : hors portée, le Row Level
  // Security masque ses projets non publiés et le compte revient à zéro, ce qui
  // désactiverait silencieusement la limite de l'offre.
  const count = await withUserScope(userId, (tx) =>
    tx.project.count({ where: { ownerId: userId, deletedAt: null } }),
  )
  if (count >= plan.maxProjects) {
    throw new AppError(
      'PLAN_LIMIT',
      `Votre offre permet ${plan.maxProjects} application(s). Choisissez une offre supérieure pour en créer d'autres.`,
      { details: { maxProjects: plan.maxProjects, current: count } },
    )
  }
}

export function slugify(value: string): string {
  const base = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base.length >= 3 ? base : 'application'
}

/**
 * Adresse publique du projet.
 *
 * On ne vérifie pas la disponibilité par une lecture préalable : hors portée de
 * locataire, le Row Level Security masquerait les projets d'autrui et la vérification
 * conclurait toujours « libre ». C'est la contrainte d'unicité de la base qui fait foi,
 * et l'appelant réessaie avec une autre adresse en cas de collision.
 */
function candidateSlug(name: string): string {
  return `${slugify(name)}-${randomBytes(3).toString('hex')}`
}

/** Vrai lorsque l'échec vient de la contrainte d'unicité sur l'adresse publique. */
function isSlugCollision(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  const target = (error as { meta?: { target?: unknown } } | null)?.meta?.target
  return code === 'P2002' && JSON.stringify(target ?? '').includes('slug')
}

/**
 * Couleurs et accroche de l'application, lues dans sa spécification.
 *
 * Le tableau de bord affiche la vignette d'une application avec ses propres couleurs et sa
 * propre phrase. Une pastille de couleur unie ne disait rien ; le dégradé et l'accroche
 * font qu'on reconnaît son application sans lire son nom.
 */
function readIdentity(draftSpec: unknown): {
  themeColor: string
  themeAccent: string
  tagline: string
} {
  const spec = draftSpec as {
    tagline?: unknown
    theme?: { colors?: { primary?: unknown; accent?: unknown } }
  }
  const colors = spec?.theme?.colors
  const primary = typeof colors?.primary === 'string' ? colors.primary : '#2563EB'
  return {
    themeColor: primary,
    themeAccent: typeof colors?.accent === 'string' ? colors.accent : primary,
    tagline: typeof spec?.tagline === 'string' ? spec.tagline : '',
  }
}

export const renameInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
})

/**
 * Renomme un projet.
 *
 * Le nom affiché dans l'atelier change, pas l'adresse publique : un slug qui bougerait
 * casserait les liens déjà partagés, les icônes déjà installées sur un écran d'accueil et
 * les caches des visiteurs. Renommer est un geste anodin ; changer d'adresse ne l'est pas.
 */
export async function renameProject(
  userId: string,
  input: z.infer<typeof renameInput>,
): Promise<{ name: string }> {
  const updated = await withUserScope(userId, (tx) =>
    tx.project.updateMany({
      where: { id: input.projectId, ownerId: userId, deletedAt: null },
      data: { name: input.name },
    }),
  )
  if (updated.count === 0) throw notFound("Ce projet n'existe pas.")
  return { name: input.name }
}

/**
 * Supprime un projet.
 *
 * Suppression marquée, pas effacement : la ligne reste, avec sa date. Un créateur qui
 * supprime par erreur l'application qu'il a mis trois semaines à construire doit pouvoir
 * être dépanné, et les données de ses visiteurs ne disparaissent pas sans trace.
 *
 * En revanche l'application cesse immédiatement d'être servie : dépublier fait partie de
 * la suppression, sans quoi « supprimé » ne voudrait rien dire pour le public.
 */
export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const removed = await withUserScope(userId, (tx) =>
    tx.project.updateMany({
      where: { id: projectId, ownerId: userId, deletedAt: null },
      data: { deletedAt: new Date(), publishedAt: null, publishedVersionId: null },
    }),
  )
  if (removed.count === 0) throw notFound("Ce projet n'existe pas.")
  logger.info('projet supprimé', { userId, projectId })
}
