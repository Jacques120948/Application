import { AppError, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { hasConnection, markConnectionError, useCredential } from '@/server/integrations/service'
import { generateOpenAiImage, type ImageResult } from '@/server/integrations/providers/openai'
import { generateGeminiImage } from '@/server/integrations/providers/gemini'
import type { AppSpec } from '@/server/spec/schema'
import { fontPairing } from '@/lib/fonts'

/**
 * Images générées avec la clé du créateur.
 *
 * Le principe : Evoliia ne possède aucune clé d'images. Le créateur connecte son compte
 * OpenAI ou Google, et chaque image est facturée là-bas. Ce que la plateforme apporte,
 * c'est le garde-fou — un plafond journalier pour qu'une boucle ou un abus ne vide pas
 * son compte — et le rangement : l'image entre dans sa bibliothèque par le même chemin
 * qu'une photo téléversée (ré-encodée, sans métadonnées, comptée dans son quota).
 *
 * La description envoyée au fournisseur est celle du créateur, complétée par le style de
 * l'application. Aucune donnée personnelle, aucun prompt système n'y passe.
 */

export const IMAGE_DAILY_LIMIT = 20
export const IMAGE_PROVIDERS = ['openai', 'google-gemini'] as const
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]

export const PROVIDER_LABEL: Record<ImageProvider, string> = {
  openai: 'OpenAI',
  'google-gemini': 'Google Gemini',
}

export type GenerationStatus = {
  provider: ImageProvider | null
  providerLabel: string | null
  dailyLimit: number
  dailyLeft: number
}

async function generatedToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return withUserScope(userId, (tx) =>
    tx.mediaAsset.count({ where: { userId, origin: 'ai', createdAt: { gte: since } } }),
  )
}

/** Le premier fournisseur connecté, dans l'ordre du catalogue. */
async function connectedProvider(userId: string): Promise<ImageProvider | null> {
  for (const provider of IMAGE_PROVIDERS) {
    if (await hasConnection(userId, provider, { target: 'EVOLIIA' })) return provider
  }
  return null
}

export async function generationStatus(userId: string): Promise<GenerationStatus> {
  const [provider, used] = await Promise.all([connectedProvider(userId), generatedToday(userId)])
  return {
    provider,
    providerLabel: provider === null ? null : PROVIDER_LABEL[provider],
    dailyLimit: IMAGE_DAILY_LIMIT,
    dailyLeft: Math.max(0, IMAGE_DAILY_LIMIT - used),
  }
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

export type GeneratedImage = { bytes: Uint8Array; mime: string; provider: ImageProvider; prompt: string }

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

  const provider = await connectedProvider(userId)
  if (provider === null) {
    throw new AppError(
      'UNSUPPORTED_REQUEST',
      'Connectez votre clé OpenAI ou Google Gemini depuis l’écran Connexions pour créer des images.',
    )
  }

  const used = await generatedToday(userId)
  if (used >= IMAGE_DAILY_LIMIT) {
    throw new AppError(
      'PLAN_LIMIT',
      `Vous avez créé ${IMAGE_DAILY_LIMIT} images ces dernières 24 heures. C'est le plafond, pour protéger votre compte ${PROVIDER_LABEL[provider]}.`,
    )
  }

  const credential = await useCredential(userId, provider, { target: 'EVOLIIA' })
  if (credential === null) {
    throw new AppError('UNSUPPORTED_REQUEST', 'La clé du fournisseur est introuvable. Reconnectez le service.')
  }

  const prompt = buildImagePrompt(cleaned, spec)
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

  logger.info('image ia générée', { userId, provider, bytes: result.bytes.length })
  return { bytes: result.bytes, mime: result.mime, provider, prompt: cleaned }
}
