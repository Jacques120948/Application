import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import type { VisibilityAgentId } from './visibility'

/**
 * Ce que la machinerie retient pour l'équipe.
 *
 * Les quatre spécialistes partagent déjà une mémoire : la phrase que chacun retient à la
 * fin d'un échange, et que les autres lisent avant de répondre. Elle avait un angle mort,
 * et il grandissait à chaque automatisation ajoutée — elle ne contenait que des
 * conversations. Tout ce que le produit faisait tout seul (un article écrit la nuit, une
 * page sortie de l'index, une fréquence qui bouge chez les assistants) n'y figurait pas.
 *
 * Résultat : Milo proposait d'écrire sur un sujet qu'il avait traité trois nuits plus tôt,
 * et Néo ignorait que vingt pages venaient d'être vérifiées. Quatre spécialistes qui ne
 * savent pas ce que la maison a fait laissent la personne faire le lien — c'est-à-dire
 * exactement le travail qu'on lui promet d'éviter.
 *
 * Deux règles tiennent ce module.
 *
 * **On ne note que ce qui a changé.** Une note par nuit et par site noierait en une semaine
 * les phrases que les spécialistes ont jugées utiles : la mémoire ne garde que les
 * dernières. Un fait sans changement n'apprend rien, et coûte la place d'un fait qui
 * apprend.
 *
 * **Aucun appel à un modèle.** Ce sont des constats, écrits par le code qui vient de les
 * produire. Les faire résumer coûterait un appel par nuit pour reformuler ce qu'on sait
 * déjà exactement.
 */

/** Une note de la machinerie, reconnaissable comme telle. */
const AUTOMATIQUE = '(automatique)'

export async function noterPourEquipe(
  userId: string,
  siteId: string,
  agent: VisibilityAgentId,
  retenir: string,
): Promise<void> {
  const propre = retenir.trim().slice(0, 200)
  if (propre === '') return

  try {
    await withUserScope(userId, (tx) =>
      tx.visibilityNote.create({
        data: {
          userId,
          siteId,
          agent,
          question: AUTOMATIQUE,
          answer: '',
          takeaway: propre,
          creditsSpent: 0,
        },
      }),
    )
  } catch (error) {
    /*
     * Une note perdue ne doit jamais faire échouer le travail qu'elle décrit. L'article est
     * écrit et payé ; que l'équipe l'apprenne est un confort, pas une condition.
     */
    logger.warn('note d’équipe non enregistrée', {
      raison: error instanceof Error ? error.message.slice(0, 120) : 'inconnu',
    })
  }
}
