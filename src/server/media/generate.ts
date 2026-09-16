import { AppError, validation } from '@/lib/errors'
import { env } from '@/lib/env'
import { prisma } from '@/server/db/client'
import { withUserScope, type TenantClient } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { generateOpenAiImage, type ImageResult } from '@/server/integrations/providers/openai'
import { generateGeminiImage, GEMINI_IMAGE_MODEL } from '@/server/integrations/providers/gemini'
import { getEffectivePlan } from '@/server/billing/plans'
import { currentPeriod } from '@/server/radar/quota'
import { creditsFor, loadPricing } from '@/server/billing/ai-pricing'
import { MINIMUM_COST, spendCredits } from '@/server/billing/credits'
import { releaseReservation, reserveCredits } from '@/server/billing/reservation'
import type { AppSpec } from '@/server/spec/schema'
import { fontPairing } from '@/lib/fonts'

/**
 * Images créées par l'IA.
 *
 * Deux voies coexistent, et l'ordre entre elles n'est pas indifférent.
 *
 * **La clé du créateur d'abord.** Il connecte son compte OpenAI ou Google, chaque image
 * est facturée là-bas, et Evoliia ne dépense rien : ni quota, ni crédit. C'est la voie de
 * celui qui veut en faire beaucoup, et elle reste la première servie.
 *
 * **La clé d'Evoliia ensuite**, pour tous les autres — c'est-à-dire pour l'immense majorité,
 * qui n'ouvrira jamais un compte Google AI. Là, c'est de l'argent qui sort réellement du
 * compte de la plateforme, et deux bornes indépendantes l'encadrent : le quota mensuel de
 * l'offre, à zéro par défaut, et les crédits du créateur, réservés avant l'appel et débités
 * au coût constaté. La première atteinte arrête.
 *
 * Pourquoi les deux plutôt qu'une ? Parce qu'elles ne protègent pas la même chose. Le quota
 * protège Evoliia d'une offre trop généreuse ; les crédits protègent le créateur de sa
 * propre gourmandise — une image coûte huit crédits quand une application entière en coûte
 * vingt et un, et douze images videraient le mois d'une offre d'entrée sans qu'il l'ait vu
 * venir.
 *
 * Un plafond journalier double le tout, des deux côtés : il ne borne pas une dépense mais
 * un emballement, celui d'une boucle qui partirait toute seule.
 *
 * La description envoyée au fournisseur est celle du créateur, complétée par le style de
 * l'application. Aucune donnée personnelle, aucun prompt système n'y passe. La clé
 * d'Evoliia, elle, ne quitte jamais le serveur.
 */

export const IMAGE_DAILY_LIMIT = 20
export const IMAGE_PROVIDERS = ['openai', 'google-gemini'] as const
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]

export const PROVIDER_LABEL: Record<ImageProvider, string> = {
  openai: 'OpenAI',
  'google-gemini': 'Google Gemini',
}

/**
 * Qui paie l'image.
 *
 * `creator` : sa propre clé, comme avant — gratuit pour Evoliia, donc sans quota ni crédit.
 * `evoliia` : la clé de la plateforme, bornée par le quota de l'offre ET par les crédits.
 *
 * Les deux origines sont distinguées en base pour cette seule raison : le quota mensuel ne
 * doit compter que ce qu'Evoliia a réellement payé. Les confondre ferait payer au créateur
 * qui a sa propre clé un quota dont il ne consomme rien.
 */
export const CREATOR_ORIGIN = 'ai'
export const EVOLIIA_ORIGIN = 'ai-evoliia'
const AI_ORIGINS = [CREATOR_ORIGIN, EVOLIIA_ORIGIN]

export type ImageSource = 'creator' | 'evoliia'

export type GenerationStatus = {
  /** Le fournisseur sollicité, ou `null` quand aucune voie n'est ouverte. */
  provider: ImageProvider | null
  providerLabel: string | null
  /** Qui paie. `null` quand la génération n'est pas disponible pour ce créateur. */
  source: ImageSource | null
  dailyLimit: number
  dailyLeft: number
  /** Quota mensuel de l'offre, quand c'est Evoliia qui paie. Zéro sinon. */
  monthlyLimit: number
  monthlyLeft: number
  /** Ce qu'une image coûtera en crédits. Zéro quand le créateur paie chez son fournisseur. */
  creditsPerImage: number
}

/**
 * Ce qu'il faut lire pour savoir ce qui est possible, en une seule fois.
 *
 * Toutes ces lectures partagent la transaction de l'appelant, et c'est le point de tout ce
 * bloc. Chaque portée de locataire ouvre une transaction — un BEGIN, un réglage de session,
 * la requête, un COMMIT : quatre allers-retours. Les compter séparément revenait, sur une
 * base distante, à payer une seconde pour afficher un écran. Mesuré en conditions réelles.
 */
type Comptes = {
  /** Images créées ces vingt-quatre heures, toutes voies confondues. */
  today: number
  /** Images payées par Evoliia depuis le début de la période d'abonnement. */
  month: number
  /** Le premier fournisseur connecté par le créateur, dans l'ordre du catalogue. */
  provider: ImageProvider | null
}

async function lireComptes(
  tx: TenantClient,
  userId: string,
  /** Début de la période mensuelle, ou `null` quand le quota d'Evoliia ne s'applique pas. */
  periodStart: Date | null,
): Promise<Comptes> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [today, month, connexions] = await Promise.all([
    tx.mediaAsset.count({
      where: { userId, origin: { in: AI_ORIGINS }, createdAt: { gte: since } },
    }),
    periodStart === null
      ? Promise.resolve(0)
      : tx.mediaAsset.count({
          where: { userId, origin: EVOLIIA_ORIGIN, createdAt: { gte: periodStart } },
        }),
    // Une requête pour les deux fournisseurs : deux comptages successifs, c'était deux
    // transactions pour une question qui tient en une.
    tx.integrationConnection.findMany({
      where: {
        userId,
        providerId: { in: [...IMAGE_PROVIDERS] },
        status: 'CONNECTED',
        disconnectedAt: null,
        target: 'EVOLIIA',
      },
      select: { providerId: true },
    }),
  ])

  const connectes = new Set(connexions.map((ligne) => ligne.providerId))
  return {
    today,
    month,
    provider: IMAGE_PROVIDERS.find((candidat) => connectes.has(candidat)) ?? null,
  }
}

/** Ce qu'une image coûte au créateur, au tarif en vigueur. */
export async function creditsPerImage(): Promise<number> {
  const table = await loadPricing()
  return creditsFor(table.imageMicros, MINIMUM_COST.image, table)
}

/** Evoliia peut-elle créer des images elle-même ? Sans clé, la fonction est simplement éteinte. */
export function isEvoliiaImageAvailable(): boolean {
  return env.geminiApiKey !== undefined
}

/**
 * Ce qui est possible, et à quel prix.
 *
 * L'ordre compte : **la clé du créateur passe d'abord**. Elle ne coûte rien à Evoliia, elle
 * ne consomme aucun crédit, et celui qui a pris la peine de la connecter veut s'en servir.
 * La voie d'Evoliia est le filet pour tous les autres.
 */
/**
 * Ce que l'écran doit savoir avant d'ouvrir la transaction.
 *
 * L'offre décide si le quota d'Evoliia s'applique, donc si la période mensuelle est même
 * utile à calculer. La lire d'abord évite d'aller chercher un portefeuille pour un créateur
 * dont l'offre n'accorde aucune image.
 */
export type GenerationContext = {
  plan: { imagesPerMonth: number }
  periodStart: Date | null
  creditsPerImage: number
}

export async function generationContext(userId: string): Promise<GenerationContext> {
  const plan = await getEffectivePlan(userId)
  const quotaPossible = isEvoliiaImageAvailable() && plan.imagesPerMonth > 0
  if (!quotaPossible) return { plan, periodStart: null, creditsPerImage: 0 }

  const [period, credits] = await Promise.all([currentPeriod(userId), creditsPerImage()])
  return { plan, periodStart: period.start, creditsPerImage: credits }
}

/** Assemble l'état à partir de ce qui a déjà été lu. Aucune requête ici. */
export function describeGeneration(
  comptes: Comptes,
  contexte: GenerationContext,
): GenerationStatus {
  const dailyLeft = Math.max(0, IMAGE_DAILY_LIMIT - comptes.today)

  // La clé du créateur passe d'abord : elle ne coûte rien à Evoliia, et celui qui a pris la
  // peine de la connecter veut s'en servir.
  if (comptes.provider !== null) {
    return {
      provider: comptes.provider,
      providerLabel: PROVIDER_LABEL[comptes.provider],
      source: 'creator',
      dailyLimit: IMAGE_DAILY_LIMIT,
      dailyLeft,
      monthlyLimit: 0,
      monthlyLeft: 0,
      creditsPerImage: 0,
    }
  }

  if (contexte.periodStart === null) {
    return {
      provider: null,
      providerLabel: null,
      source: null,
      dailyLimit: IMAGE_DAILY_LIMIT,
      dailyLeft,
      monthlyLimit: contexte.plan.imagesPerMonth,
      monthlyLeft: 0,
      creditsPerImage: 0,
    }
  }

  return {
    provider: 'google-gemini',
    providerLabel: PROVIDER_LABEL['google-gemini'],
    source: 'evoliia',
    dailyLimit: IMAGE_DAILY_LIMIT,
    dailyLeft,
    monthlyLimit: contexte.plan.imagesPerMonth,
    monthlyLeft: Math.max(0, contexte.plan.imagesPerMonth - comptes.month),
    creditsPerImage: contexte.creditsPerImage,
  }
}

/**
 * Ce qui est possible, et à quel prix.
 *
 * Une seule transaction pour tous les comptages. L'écran des images appelle plutôt
 * `generationContext` puis `readGeneration`, afin de partager sa propre transaction ; cette
 * fonction-ci sert aux appels isolés.
 */
export async function generationStatus(userId: string): Promise<GenerationStatus> {
  const contexte = await generationContext(userId)
  const comptes = await withUserScope(userId, (tx) =>
    lireComptes(tx, userId, contexte.periodStart),
  )
  return describeGeneration(comptes, contexte)
}

/** Les comptages, dans une transaction déjà ouverte. Réservé à l'écran des images. */
export async function readGeneration(
  tx: TenantClient,
  userId: string,
  contexte: GenerationContext,
): Promise<GenerationStatus> {
  return describeGeneration(await lireComptes(tx, userId, contexte.periodStart), contexte)
}

/**
 * La description complète envoyée au fournisseur.
 *
 * Le créateur dit le sujet ; le style vient de l'application, pour que l'image ne jure pas
 * avec la page. Pas de texte dans l'image : les modèles l'écrivent mal, et le titre est
 * déjà sur la page.
 */
export function buildImagePrompt(subject: string, spec: Pick<AppSpec, 'name' | 'theme'>): string {
  const pairing = fontPairing(spec.theme.font)
  const mood =
    spec.theme.mode === 'dark' ? 'ambiance sombre et contrastée' : 'ambiance claire et lumineuse'
  const tone: Record<string, string> = {
    elegant: 'raffiné, épuré',
    editorial: 'photographie éditoriale, naturelle',
    playful: 'joyeux, couleurs franches',
    bold: 'graphique, affirmé',
    geometric: 'net, moderne',
    rounded: 'chaleureux, accueillant',
    serif: 'classique, posé',
    system: 'sobre, professionnel',
  }
  return [
    subject.trim(),
    `Style : ${tone[pairing.id] ?? 'sobre'}, ${mood}, teintes dominantes proches de ${spec.theme.colors.primary} et ${spec.theme.colors.accent}.`,
    'Photographie ou illustration de qualité, cadrage paysage, sans aucun texte, sans logo, sans filigrane, sans personne réelle identifiable.',
  ].join(' ')
}

export type GeneratedImage = {
  bytes: Uint8Array
  mime: string
  provider: ImageProvider
  prompt: string
  /** Qui a payé. Décide de l'origine enregistrée, donc du quota qui sera décompté. */
  source: ImageSource
  /** Crédits réellement débités. Zéro quand le créateur a payé chez son fournisseur. */
  creditsSpent: number
}

/**
 * Demande une image au fournisseur connecté. Ne stocke rien : c'est `addMedia` qui range,
 * avec ses propres contrôles de quota. Les deux sont séparés pour que la transaction de
 * base n'attende jamais un appel réseau lent.
 */
export async function requestImage(
  userId: string,
  subject: string,
  spec: Pick<AppSpec, 'name' | 'theme'>,
): Promise<GeneratedImage> {
  const cleaned = subject.trim()
  if (cleaned.length < 5) throw validation('Décrivez l’image en quelques mots au moins.')
  if (cleaned.length > 600) throw validation('La description est trop longue (600 caractères au maximum).')

  const status = await generationStatus(userId)
  if (status.source === null) {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      isEvoliiaImageAvailable()
        ? "Votre offre ne comprend pas d'images créées par l'IA. Vous pouvez aussi connecter votre propre clé OpenAI ou Google depuis l'écran Connexions."
        : "Connectez votre clé OpenAI ou Google Gemini depuis l'écran Connexions pour créer des images.",
    )
  }

  // Le plafond journalier borne l'emballement, des deux côtés : une boucle qui partirait
  // toute seule s'arrête ici, avant le quota mensuel comme avant les crédits.
  if (status.dailyLeft <= 0) {
    throw new AppError(
      'PLAN_LIMIT',
      `Vous avez créé ${IMAGE_DAILY_LIMIT} images ces dernières 24 heures. C'est le plafond quotidien ; il se relâche au fil des heures.`,
    )
  }

  const prompt = buildImagePrompt(cleaned, spec)
  return status.source === 'creator'
    ? avecLaCleDuCreateur(userId, cleaned, prompt, status)
    : auxFraisDEvoliia(userId, cleaned, prompt, status)
}

/** La voie d'avant : le fournisseur du créateur facture le créateur. Evoliia ne dépense rien. */
async function avecLaCleDuCreateur(
  userId: string,
  subject: string,
  prompt: string,
  status: GenerationStatus,
): Promise<GeneratedImage> {
  const provider = status.provider as ImageProvider
  const credential = await useCredential(userId, provider, { target: 'EVOLIIA' })
  if (credential === null) {
    throw new AppError('UNSUPPORTED_REQUEST', 'La clé du fournisseur est introuvable. Reconnectez le service.')
  }

  const result: ImageResult =
    provider === 'openai'
      ? await generateOpenAiImage(credential.secret, prompt)
      : await generateGeminiImage(credential.secret, prompt)

  if (!result.ok) {
    if (result.kind === 'key') {
      await markConnectionError(userId, credential.connectionId, `${PROVIDER_LABEL[provider]} refuse la clé.`)
    }
    logger.warn('image ia refusée', { userId, provider, kind: result.kind })
    throw new AppError(result.kind === 'quota' ? 'PLAN_LIMIT' : 'UNSUPPORTED_REQUEST', result.reason)
  }

  logger.info('image ia générée', { userId, provider, source: 'creator' })
  return {
    bytes: result.bytes,
    mime: result.mime,
    provider,
    prompt: subject,
    source: 'creator',
    creditsSpent: 0,
  }
}

/**
 * La voie d'Evoliia : la plateforme paie le fournisseur, le créateur paie en crédits.
 *
 * L'ordre des gestes est celui qui protège des deux erreurs opposées.
 *
 * **Réserver avant d'appeler.** Vérifier le solde après coup laisserait passer un appel
 * qu'on ne peut pas facturer, et deux demandes simultanées passeraient toutes les deux.
 *
 * **Ne débiter qu'après un succès.** Un fournisseur qui refuse ne facture pas Evoliia ; le
 * créateur ne doit donc rien payer non plus. La réservation est rendue dans tous les cas.
 */
async function auxFraisDEvoliia(
  userId: string,
  subject: string,
  prompt: string,
  status: GenerationStatus,
): Promise<GeneratedImage> {
  if (status.monthlyLeft <= 0) {
    throw new AppError(
      'PLAN_LIMIT',
      `Votre offre comprend ${status.monthlyLimit} image${status.monthlyLimit > 1 ? 's' : ''} par mois, et elles sont utilisées. Connectez votre propre clé Google ou OpenAI pour continuer sans limite.`,
    )
  }

  const cle = env.geminiApiKey
  if (cle === undefined) {
    throw new AppError('UNSUPPORTED_REQUEST', "La création d'images n'est pas disponible pour le moment.")
  }

  const reservation = await reserveCredits({
    userId,
    operation: 'image',
    amount: status.creditsPerImage,
  })

  try {
    const result = await generateGeminiImage(cle, prompt)
    if (!result.ok) {
      // La clé est celle d'Evoliia : un refus est un incident de la plateforme, pas une
      // faute du créateur. On le trace pour nous, et on lui dit ce qui le concerne.
      logger.error('image ia refusée sur la clé Evoliia', { userId, kind: result.kind })
      throw new AppError(
        'AI_UNAVAILABLE',
        "La création d'image n'a pas abouti. Rien ne vous a été débité — réessayez dans un instant.",
      )
    }

    const table = await loadPricing()
    const credits = creditsFor(table.imageMicros, MINIMUM_COST.image, table)
    const usage = await prisma.aiUsage
      .create({
        data: {
          userId,
          operation: 'image',
          model: GEMINI_IMAGE_MODEL,
          costMicros: table.imageMicros,
          creditsSpent: credits,
          success: true,
        },
        select: { id: true },
      })
      .catch(() => null)

    await spendCredits(userId, credits, 'image', undefined, {
      ...(usage === null ? {} : { aiUsageId: usage.id }),
    })

    logger.info('image ia générée', { userId, source: 'evoliia', credits })
    return {
      bytes: result.bytes,
      mime: result.mime,
      provider: 'google-gemini',
      prompt: subject,
      source: 'evoliia',
      creditsSpent: credits,
    }
  } finally {
    await releaseReservation(reservation.id)
  }
}
