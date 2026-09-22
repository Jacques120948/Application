import type { Stripe } from '@/server/billing/stripe/client'
import { refundLastPayment } from '@/server/billing/stripe/subscriptions'
import { z } from 'zod'
import { FEATURE_IDS } from '@/server/billing/features'
import { FLAGS, readFlags, setFlag, type FlagName } from '@/server/settings/flags'
import { prisma } from '@/server/db/client'
import { notFound } from '@/lib/errors'
import { getCurrentUser } from '@/server/auth/session'
import { logger } from '@/server/observability/logger'
import { bilanSupervisionMeta, type SupervisionMeta } from '@/server/ads/supervision-meta'
import { FREE_PLAN_ID, PLANNED_PLAN_CAPABILITIES } from '@/server/billing/plans'
import {
  DEFAULT_MODEL_PRICING,
  forgetPricingCache,
  loadPricing,
  PRICING_SETTINGS,
} from '@/server/billing/ai-pricing'
import { readSetting, writeSetting } from '@/server/settings/store'
import { isEvoliiaImageAvailable } from '@/server/media/generate'
import { DEFAULT_MAX_DOCUMENT_TOKENS, DOCUMENT_SETTINGS } from '@/server/ai/documents'
import { AGENT_SETTINGS, loadAgentLimits } from '@/server/agent/limits'
import {
  getLegalIdentity,
  legalIdentityInput,
  saveLegalIdentity,
} from '@/server/settings/legal'

/**
 * Back-office.
 *
 * Il remplace les requêtes SQL qu'il fallait jusqu'ici écrire à la main pour changer un
 * prix ou attribuer une offre. Deux principes :
 *
 *   1. Une seule porte. `requireAdmin()` est appelé au début de chaque opération, y
 *      compris en lecture. Un visiteur non administrateur reçoit « introuvable » plutôt
 *      qu'« interdit » : inutile de lui apprendre que cette page existe.
 *   2. Aucune table protégée n'est lue ici. Le Row Level Security masque les projets et
 *      les idées des autres, et ce n'est pas au back-office de le contourner. Les
 *      compteurs portent donc sur ce qui est public ou global.
 */

export async function requireAdmin() {
  const user = await getCurrentUser()
  if (user === null || user.role !== 'ADMIN') throw notFound()
  return user
}

// ───────────────────────────────── Offres ────────────────────────────────────

export const planUpdateInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(400),
  priceCents: z.number().int().min(0).max(1_000_000),
  /*
   * Douze mois payés d'avance. Zéro : cette offre ne se prend pas à l'année — et c'est la
   * valeur de départ partout, parce qu'une remise est une décision commerciale et ne
   * s'allume pas parce que le champ existe. Aucun taux n'est stocké : la remise annoncée
   * se déduit de ce prix et du mensuel, ce qui les empêche de se contredire.
   */
  priceYearCents: z.number().int().min(0).max(12_000_000),
  maxProjects: z.number().int().min(0).max(1_000),
  maxConnections: z.number().int().min(0).max(100),
  /** Espace d'images, en mégaoctets. Converti en octets avant écriture. */
  storageMegabytes: z.number().int().min(0).max(20_000),
  monthlyCredits: z.number().int().min(0).max(1_000_000),
  /*
   * Ce que l'offre accorde dans le produit d'aujourd'hui.
   *
   * Ces trois bornes n'étaient modifiables qu'en SQL, alors qu'elles décident de tout ce
   * qui se vend — combien de sites, quelle profondeur d'analyse, combien de fois par mois.
   * Le back-office promettait « les offres se règlent ici, sans redéploiement » et ne
   * tenait cette promesse que pour le prix. Les pages sont bornées haut parce qu'un audit
   * n'est pas du calcul gratuit : c'est un parcours réel de pages sur le réseau, à la
   * charge d'Evoliia.
   */
  sitesMax: z.number().int().min(0).max(1_000),
  pagesPerAudit: z.number().int().min(0).max(100_000),
  auditsPerMonth: z.number().int().min(0).max(1_000),
  /*
   * Quotas mensuels des deux modules. Bornés haut, jamais illimités : un quota qu'on peut
   * régler à « sans limite » finit par l'être un jour, et c'est ce jour-là que la facture
   * arrive.
   */
  radarRunsPerMonth: z.number().int().min(0).max(1_000),
  liaAnswersPerMonth: z.number().int().min(0).max(100_000),
  /** Alertes par courriel au créateur. Zéro ferme la fonction pour cette offre. */
  alertsPerMonth: z.number().int().min(0).max(100_000),
  /**
   * Images créées sur le compte d'Evoliia. Zéro ferme la fonction pour cette offre.
   *
   * Cette borne-là n'est pas comme les autres : elle ne plafonne pas du calcul déjà payé,
   * elle plafonne de l'argent qui sort. Le maximum est donc volontairement bas — à quatre
   * centimes l'image, mille par mois et par créateur seraient quarante dollars.
   */
  imagesPerMonth: z.number().int().min(0).max(1_000),
  liaConversationsPerMonth: z.number().int().min(0).max(100_000),
  allowBuild: z.boolean(),
  isRecommended: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(100),
  /*
   * Fonctions ouvertes par l'offre. Déplacer une fonction d'une offre à l'autre est une
   * décision commerciale, pas une modification de code : elle se prend ici. Seuls les
   * identifiants du catalogue sont acceptés — un identifiant libre créerait un droit que
   * rien ne sait honorer.
   */
  features: z.array(z.enum(FEATURE_IDS as [string, ...string[]])).max(40).default([]),
})

export type PlanUpdateInput = z.infer<typeof planUpdateInput>

export async function listPlans() {
  await requireAdmin()
  return prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] })
}

/**
 * Les capacités non construites ne sont pas modifiables ici : les exposer reviendrait à
 * offrir un bouton qui promet une fonction inexistante. Elles sont forcées à faux.
 */
export async function updatePlan(planId: string, input: PlanUpdateInput) {
  const admin = await requireAdmin()
  const existing = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } })
  if (existing === null) throw notFound("Cette offre n'existe pas.")

  const plan = await prisma.$transaction(async (tx) => {
    // Une seule offre mise en avant : cocher celle-ci décoche les autres.
    if (input.isRecommended) {
      await tx.plan.updateMany({
        where: { id: { not: planId }, isRecommended: true },
        data: { isRecommended: false },
      })
    }
    const { storageMegabytes, ...rest } = input
    return tx.plan.update({
      where: { id: planId },
      data: {
        ...rest,
        storageBytes: storageMegabytes * 1024 * 1024,
        ...Object.fromEntries(PLANNED_PLAN_CAPABILITIES.map((capability) => [capability, false])),
      },
    })
  })

  logger.info('offre modifiée', { adminId: admin.id, planId })
  return plan
}

// ──────────────────────────────── Comptes ────────────────────────────────────

export const userSearchInput = z.object({
  query: z.string().trim().max(120).default(''),
  take: z.number().int().min(1).max(100).default(50),
})

export async function listUsers(input: z.infer<typeof userSearchInput>) {
  await requireAdmin()
  const users = await prisma.user.findMany({
    where:
      input.query === ''
        ? {}
        : {
            OR: [
              { email: { contains: input.query, mode: 'insensitive' } },
              { name: { contains: input.query, mode: 'insensitive' } },
            ],
          },
    orderBy: { createdAt: 'desc' },
    take: input.take,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      disabledAt: true,
      subscription: { select: { planId: true, status: true, stripeSubscriptionId: true } },
      wallet: { select: { balance: true, monthlyGrant: true } },
    },
  })

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    disabled: user.disabledAt !== null,
    planId: user.subscription?.planId ?? FREE_PLAN_ID,
    subscriptionStatus: user.subscription?.status ?? null,
    /** Abonnement payé par Stripe : un remboursement est possible depuis le back-office. */
    managedByStripe: user.subscription?.stripeSubscriptionId != null,
    credits: user.wallet?.balance ?? 0,
  }))
}

export const refundInput = z.object({
  /** Fermer l'abonnement en même temps que rembourser. */
  cancel: z.boolean().default(true),
})

/** Rembourse la dernière facture d'un abonné Stripe. L'argent d'Evoliia repart : administrateur seulement. */
export async function refundUserPayment(stripe: Stripe, userId: string, input: z.infer<typeof refundInput>) {
  const admin = await requireAdmin()
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (user === null) throw notFound("Ce compte n'existe pas.")
  const result = await refundLastPayment(stripe, userId, { cancel: input.cancel })
  logger.info('remboursement accordé', { adminId: admin.id, userId, ...result })
  return result
}

export const setPlanInput = z.object({
  /** `null` ramène le compte à l'offre gratuite en supprimant son abonnement. */
  planId: z.string().trim().min(1).max(48).nullable(),
})

export async function setUserPlan(userId: string, planId: string | null) {
  const admin = await requireAdmin()

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (user === null) throw notFound("Ce compte n'existe pas.")

  if (planId === null || planId === FREE_PLAN_ID) {
    await prisma.subscription.deleteMany({ where: { userId } })
    logger.info('offre retirée', { adminId: admin.id, userId })
    return
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } })
  if (plan === null) throw notFound("Cette offre n'existe pas.")

  await prisma.subscription.upsert({
    where: { userId },
    update: { planId, status: 'ACTIVE' },
    create: { userId, planId, status: 'ACTIVE' },
  })
  logger.info('offre attribuée', { adminId: admin.id, userId, planId })
}

// ──────────────────────────────── Chiffres ───────────────────────────────────

/**
 * Les quatre chiffres de tête.
 *
 * Ils ne comptent que ce que l'exploitant a le droit de lire à l'échelle de l'installation,
 * et cette contrainte n'est pas un pis-aller : c'est la garantie du produit vue de l'autre
 * côté. `Site` et `Audit` sont sous cloisonnement forcé, et leur règle exige une identité.
 * Une administration ne parle au nom de personne : un comptage ordinaire y rend zéro — un
 * chiffre faux et d'apparence normale, ce qui est la pire espèce.
 *
 * « Sites suivis » et « Analyses ce mois » ont été essayés, et retirés. Les obtenir demande
 * soit un contournement accordé au rôle applicatif — la lecture de toutes les lignes de tout
 * le monde, ouverte à tout le code, pour afficher deux entiers — soit une branche
 * « administrateur » dans les règles elles-mêmes. Une fonction à droits du propriétaire ne
 * suffit pas : `FORCE ROW LEVEL SECURITY` soumet le propriétaire à ses propres règles, et
 * c'est exactement ce qu'on lui demande de faire. Aucune de ces deux portes ne s'ouvre pour
 * un chiffre d'écran.
 *
 * `AiUsage` se lit en revanche sans détour, et pour la raison écrite auprès des tables
 * protégées : elle n'existe que pour être lue par l'exploitant, aucun écran de client ne la
 * relit. Elle dit d'ailleurs la chose la plus utile des quatre — ce qu'Evoliia dépense
 * réellement chez son fournisseur, et ce qui échoue.
 */
export async function getAdminOverview() {
  await requireAdmin()
  const maintenant = new Date()
  const debutDuMois = new Date(
    Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1),
  )

  const [users, subscriptions, calls, failures] = await Promise.all([
    prisma.user.count(),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.aiUsage.count({ where: { createdAt: { gte: debutDuMois } } }),
    prisma.aiUsage.count({ where: { createdAt: { gte: debutDuMois }, success: false } }),
  ])
  return { users, subscriptions, calls, failures }
}

// ──────────────────────────── Identité légale ────────────────────────────────

export { legalIdentityInput }

export async function readLegalIdentity() {
  await requireAdmin()
  return getLegalIdentity()
}

export async function updateLegalIdentity(
  input: Parameters<typeof saveLegalIdentity>[0],
): Promise<void> {
  const admin = await requireAdmin()
  await saveLegalIdentity(input)
  logger.info('identité légale enregistrée', { adminId: admin.id })
}

// ──────────────────────────── Interrupteurs ──────────────────────────────────

export const flagInput = z.object({
  name: z.enum(Object.keys(FLAGS) as [FlagName, ...FlagName[]]),
  enabled: z.boolean(),
})

export async function listFlags() {
  await requireAdmin()
  const state = await readFlags()
  return (Object.keys(FLAGS) as FlagName[]).map((name) => ({
    name,
    label: FLAGS[name].label,
    help: FLAGS[name].help,
    enabled: state[name],
  }))
}

/**
 * Allume ou éteint une fonction pour toute l'installation.
 *
 * À distinguer des droits par abonnement : ceux-ci disent ce qu'une offre ouvre, un
 * interrupteur dit si la fonction existe du tout. Éteinte, elle l'est pour tout le monde.
 */
export async function updateFlag(input: z.infer<typeof flagInput>) {
  const admin = await requireAdmin()
  await setFlag(input.name, input.enabled)
  logger.info('interrupteur basculé', {
    adminId: admin.id,
    flag: input.name,
    enabled: input.enabled,
  })
}

// ───────────────────────── Santé de l'assistant ──────────────────────────────

export type AiFailure = {
  id: string
  operation: string
  model: string
  errorCode: string | null
  errorMessage: string | null
  email: string
  createdAt: string
}

/**
 * Les derniers appels IA en échec, avec le message du fournisseur.
 *
 * C'est le premier endroit où regarder quand « ça ne marche pas » : sans lui, il faudrait
 * ouvrir les journaux de l'hébergeur. Les messages sont expurgés à l'écriture.
 */
export async function listAiFailures(take = 20): Promise<AiFailure[]> {
  await requireAdmin()
  const rows = await prisma.aiUsage.findMany({
    where: { success: false },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      operation: true,
      model: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    operation: row.operation,
    model: row.model,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    email: row.user.email,
    createdAt: row.createdAt.toISOString(),
  }))
}

// ───────────────────── Tarifs des modèles et marge ───────────────────────────

/**
 * Les trois réglages qui décident de ce qu'une opération IA coûte au créateur.
 *
 * Ils vivaient dans le code. Les en sortir permet de réagir à un changement de tarif
 * d'Anthropic, ou d'ajuster la marge, sans déploiement — c'est-à-dire le jour où il faut
 * réagir vite. Le code garde les valeurs actuelles en secours : une table vidée par erreur
 * ne fait pas tomber la facturation à zéro.
 */

export type ModelPricingRow = {
  model: string
  label: string
  /** Tarifs en centimes de dollar par million de jetons, comme Anthropic les publie. */
  input: number
  output: number
  cacheRead: number
  isActive: boolean
  /** Vrai tant que la ligne n'existe qu'en secours, dans le code. */
  fromCode: boolean
}

export async function listModelPricing(): Promise<{
  models: ModelPricingRow[]
  multiplier: number
  microsPerCredit: number
  imageMicros: number
  /**
   * La clé d'images d'Evoliia est-elle en place ? Jamais sa valeur — seulement le fait.
   *
   * Sans cet indicateur, le créateur et l'administrateur lisent le même message —
   * « votre offre ne comprend pas d'images » — pour deux causes opposées : un quota à
   * zéro, ou une clé absente. Le premier se règle dans l'écran d'à côté, le second dans
   * l'hébergeur. Les confondre coûte une heure de recherche à chaque fois.
   */
  imageKeyConfigured: boolean
}> {
  await requireAdmin()
  const [rows, table] = await Promise.all([prisma.aiModelPricing.findMany(), loadPricing()])
  const byModel = new Map(rows.map((row) => [row.model, row]))

  const names = new Set([...Object.keys(DEFAULT_MODEL_PRICING), ...byModel.keys()])
  const models = [...names].sort().map((model) => {
    const stored = byModel.get(model)
    const fallback = DEFAULT_MODEL_PRICING[model]
    return {
      model,
      label: stored?.label ?? fallback?.label ?? model,
      input: stored?.inputCentsPerMTok ?? fallback?.input ?? 0,
      output: stored?.outputCentsPerMTok ?? fallback?.output ?? 0,
      cacheRead: stored?.cacheReadCentsPerMTok ?? fallback?.cacheRead ?? 0,
      isActive: stored?.isActive ?? true,
      fromCode: stored === undefined,
    }
  })

  return {
    models,
    multiplier: table.multiplier,
    microsPerCredit: table.microsPerCredit,
    imageMicros: table.imageMicros,
    imageKeyConfigured: isEvoliiaImageAvailable(),
  }
}

export const modelPricingInput = z.object({
  model: z.string().min(3).max(80),
  label: z.string().min(1).max(80),
  input: z.number().int().min(0).max(1_000_000),
  output: z.number().int().min(0).max(1_000_000),
  cacheRead: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
})

export async function updateModelPricing(input: z.infer<typeof modelPricingInput>) {
  const admin = await requireAdmin()
  await prisma.aiModelPricing.upsert({
    where: { model: input.model },
    update: {
      label: input.label,
      inputCentsPerMTok: input.input,
      outputCentsPerMTok: input.output,
      cacheReadCentsPerMTok: input.cacheRead,
      isActive: input.isActive,
    },
    create: {
      model: input.model,
      label: input.label,
      inputCentsPerMTok: input.input,
      outputCentsPerMTok: input.output,
      cacheReadCentsPerMTok: input.cacheRead,
      isActive: input.isActive,
    },
  })
  forgetPricingCache()
  logger.info('tarif de modèle modifié', { adminId: admin.id, model: input.model })
}

export const creditSettingsInput = z.object({
  /** Marge Evoliia. À 1, le créateur paie exactement ce qu'Evoliia dépense. */
  multiplier: z.number().min(0.1).max(20),
  /** Micro-dollars de coût API pour un crédit. */
  microsPerCredit: z.number().int().min(1).max(1_000_000),
  /**
   * Micro-dollars que coûte une image à Evoliia.
   *
   * Elle ne se compte pas en jetons : le fournisseur facture à l'image. C'est donc le seul
   * tarif qui vit ici plutôt que dans la table des modèles.
   */
  imageMicros: z.number().int().min(100).max(5_000_000),
})

export async function updateCreditSettings(input: z.infer<typeof creditSettingsInput>) {
  const admin = await requireAdmin()
  await writeSetting(PRICING_SETTINGS.multiplier, String(input.multiplier))
  await writeSetting(PRICING_SETTINGS.microsPerCredit, String(input.microsPerCredit))
  await writeSetting(PRICING_SETTINGS.imageMicros, String(input.imageMicros))
  forgetPricingCache()
  logger.info('conversion des crédits modifiée', {
    adminId: admin.id,
    multiplier: input.multiplier,
  })
}

// ───────────────────── Bornes de l'agent de construction ─────────────────────

/**
 * Ce qu'une exécution de l'agent a le droit de consommer.
 *
 * C'est le réglage le plus sensible de l'installation : c'est lui qui décide de ce qu'une
 * seule demande peut coûter, et donc de ce qu'un usage anormal peut produire comme
 * facture. Les valeurs du code sont prudentes ; les élargir se fait sur mesures, pas sur
 * impression.
 */
export async function readAgentLimits() {
  await requireAdmin()
  const [limits, brut] = await Promise.all([
    loadAgentLimits(),
    readSetting(DOCUMENT_SETTINGS.maxTokens),
  ])
  const valeur = brut === null ? Number.NaN : Number(brut)
  return {
    ...limits,
    documentTokens:
      Number.isFinite(valeur) && valeur > 0 ? Math.round(valeur) : DEFAULT_MAX_DOCUMENT_TOKENS,
  }
}

export const agentLimitsInput = z.object({
  maxSteps: z.number().int().min(2).max(24),
  maxTokens: z.number().int().min(5_000).max(400_000),
  maxCredits: z.number().int().min(5).max(400),
  /** En secondes dans l'interface : des millisecondes ne se saisissent pas à la main. */
  maxDurationSeconds: z.number().int().min(30).max(600),
  /**
   * Jetons qu'un document joint peut représenter.
   *
   * Cette borne-là ne protège pas Evoliia — la réservation s'en charge — mais le créateur :
   * sans elle, joindre un PDF de deux cents pages épuiserait son budget d'un coup, et il ne
   * l'apprendrait qu'après. Elle est vérifiée avant le premier appel, par un comptage
   * gratuit, donc un refus ne coûte rien à personne.
   */
  documentTokens: z.number().int().min(2_000).max(200_000),
})

export async function updateAgentLimits(input: z.infer<typeof agentLimitsInput>) {
  const admin = await requireAdmin()
  await writeSetting(AGENT_SETTINGS.maxSteps, String(input.maxSteps))
  await writeSetting(AGENT_SETTINGS.maxTokens, String(input.maxTokens))
  await writeSetting(AGENT_SETTINGS.maxCredits, String(input.maxCredits))
  await writeSetting(AGENT_SETTINGS.maxDurationMs, String(input.maxDurationSeconds * 1000))
  await writeSetting(DOCUMENT_SETTINGS.maxTokens, String(input.documentTokens))
  logger.info('bornes de l’agent modifiées', { adminId: admin.id, ...input })
}

// ──────────────────── Ce que les créateurs n'ont pas pu résoudre ─────────────

export type ReportRow = {
  id: string
  email: string
  screen: string
  message: string
  context: string
  status: string
  createdAt: string
}

/**
 * Les signalements, les ouverts d'abord.
 *
 * C'est le seul écran où l'on apprend qu'un créateur est bloqué. Le contexte est affiché
 * avec le message et non derrière un lien : chercher l'offre et les erreurs dans trois
 * autres écrans est exactement ce que ce mécanisme sert à éviter.
 */
export async function listReports(take = 30): Promise<ReportRow[]> {
  await requireAdmin()
  const rows = await prisma.creatorReport.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take,
    select: {
      id: true,
      screen: true,
      message: true,
      context: true,
      status: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    email: row.user.email,
    screen: row.screen,
    message: row.message,
    context: row.context,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function closeReport(id: string): Promise<void> {
  const admin = await requireAdmin()
  await prisma.creatorReport.update({
    where: { id },
    data: { status: 'handled', handledAt: new Date() },
  })
  logger.info('signalement traité', { adminId: admin.id, id })
}

export type UnmetRow = {
  id: string
  email: string
  request: string
  reply: string
  explicit: boolean
  createdAt: string
}

/**
 * Les demandes restées sans suite, les explicites d'abord.
 *
 * « Explicite » veut dire que l'assistant a dit lui-même que la demande sortait de son
 * vocabulaire : c'est une fonction qui manque, et c'est ce qu'il faut lire en premier. Le
 * reste — les demandes auxquelles rien n'a changé — contient des questions, des réponses
 * suffisantes et des échecs mêlés ; utile, mais moins net.
 */
export async function listUnmetRequests(take = 40): Promise<UnmetRow[]> {
  await requireAdmin()
  const rows = await prisma.unmetRequest.findMany({
    orderBy: [{ explicit: 'desc' }, { createdAt: 'desc' }],
    take,
    select: {
      id: true,
      request: true,
      reply: true,
      explicit: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    email: row.user.email,
    request: row.request,
    reply: row.reply,
    explicit: row.explicit,
    createdAt: row.createdAt.toISOString(),
  }))
}

// ─────────────────────── Surveillance de ce que MIRA écrit ───────────────────

/**
 * Le bilan d'exploitation de MIRA, pour le back-office.
 *
 * Il ne lit pas le journal des clients, et ne le peut pas : celui-ci est cloisonné par
 * propriétaire, sans exception pour l'administrateur — qui est un utilisateur comme un
 * autre. Un comptage fait ici y rendrait zéro, en silence. Il lit donc les compteurs
 * d'exploitation, qui ne portent aucune donnée de client : le geste, son issue, ce que Meta
 * a répondu.
 *
 * Ce qu'on ne peut donc pas savoir depuis cet écran : **chez qui**. C'est le prix du
 * cloisonnement, et il est assumé — la question à laquelle ce bilan répond est « MIRA
 * fonctionne-t-elle », pas « que fait ce client ».
 */
export async function supervisionMeta(): Promise<SupervisionMeta> {
  await requireAdmin()
  return bilanSupervisionMeta()
}
