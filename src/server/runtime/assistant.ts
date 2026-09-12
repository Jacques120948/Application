import { z } from 'zod'
import { AppError, notFound, validation } from '@/lib/errors'
import { answerAsAppAssistant } from '@/server/ai/operations'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { resolveRuntimeSpec } from './context'
import { countAssistantAnswersToday, recordAssistantAnswer } from './published'

/**
 * Assistant intégré à une application créée.
 *
 * Le point délicat de cette fonction est économique, pas technique : ce sont les visiteurs
 * du créateur qui posent les questions, et c'est lui qui les paie. Trois garde-fous, dans
 * cet ordre :
 *
 *   1. Un plafond journalier par application, compté en base et donc valable quel que soit
 *      le serveur qui répond. Une application qui devient virale ne vide pas un
 *      portefeuille en une nuit.
 *   2. Le solde de crédits du créateur, vérifié avant l'appel. À zéro, l'assistant se tait
 *      poliment au lieu de creuser une dette.
 *   3. Une question bornée en longueur : le coût d'un appel est proportionnel à ce qu'on
 *      envoie.
 *
 * L'aperçu du créateur suit exactement les mêmes règles : il teste ce que vivront ses
 * visiteurs, y compris le plafond.
 */

/** Réponses maximales par application et par jour, toutes personnes confondues. */
export const DAILY_ANSWER_LIMIT = 200

/**
 * Qui paie l'appel.
 *
 * Le créateur qui a connecté sa propre clé Anthropic répond sur son compte : ses crédits
 * Evoliia ne bougent pas. Le plafond journalier s'applique quand même — il protège son
 * portefeuille, pas seulement le nôtre.
 */
async function creatorKeyFor(ownerId: string): Promise<{ id: string; secret: string } | null> {
  const credential = await useCredential(ownerId, 'anthropic', { target: 'APP' })
  return credential === null ? null : { id: credential.connectionId, secret: credential.secret }
}

export const assistantInput = z.object({
  blockId: z.string().trim().min(1).max(48),
  question: z.string().trim().min(2).max(500),
})

export type AssistantInput = z.infer<typeof assistantInput>

export async function askAppAssistant(
  projectId: string,
  input: AssistantInput,
): Promise<{ answer: string }> {
  const runtime = await resolveRuntimeSpec(projectId)

  const block = runtime.spec.pages
    .flatMap((page) => page.blocks)
    .find((candidate) => candidate.id === input.blockId && candidate.type === 'assistant')

  if (block === undefined || block.type !== 'assistant') {
    throw notFound("Cette application n'a pas d'assistant à cet endroit.")
  }

  const today = await countAssistantAnswersToday(runtime.projectId)
  if (today >= DAILY_ANSWER_LIMIT) {
    throw validation(
      "L'assistant a atteint sa limite de questions pour aujourd'hui. Revenez demain.",
    )
  }

  const creatorKey = await creatorKeyFor(runtime.ownerId)

  const call = (key: string | null) =>
    answerAsAppAssistant({
      ownerId: runtime.ownerId,
      projectId: runtime.projectId,
      appName: runtime.spec.name,
      role: block.role,
      question: input.question,
      locale: runtime.spec.locale,
      creatorKey: key,
    })

  try {
    let result
    try {
      result = await call(creatorKey?.secret ?? null)
    } catch (error) {
      /*
       * Clé du créateur refusée : l'application continue de répondre, sur les crédits
       * Evoliia du créateur, et la connexion est marquée en erreur pour qu'il le découvre
       * sur son écran « Connexions » plutôt qu'au travers d'une application muette.
       */
      if (!(error instanceof AppError && error.code === 'CREATOR_KEY_REJECTED')) throw error
      if (creatorKey !== null) {
        await markConnectionError(runtime.ownerId, creatorKey.id, error.message)
      }
      result = await call(null)
    }
    await recordAssistantAnswer(runtime.projectId)
    return { answer: result.answer }
  } catch (error) {
    /*
     * Le visiteur n'a pas à connaître l'état du portefeuille du créateur : ce serait une
     * information commerciale sur quelqu'un d'autre. Il reçoit une indisponibilité, le
     * créateur voit la vraie cause dans ses crédits.
     */
    if (error instanceof AppError && error.code === 'INSUFFICIENT_CREDITS') {
      throw new AppError(
        'AI_UNAVAILABLE',
        "L'assistant est momentanément indisponible. Réessayez plus tard.",
      )
    }
    throw error
  }
}
