import { compteActif } from '@/server/ads/comptes'
import { isEnabled } from '@/server/settings/flags'
import type { VisibilityAgentId } from '@/server/agents/visibility'

/**
 * Ce que chaque agent a le droit de faire, dit en trois niveaux.
 *
 * - **Conseil** : il analyse et recommande. Rien ne part.
 * - **Assisté** : il prépare une action toute montée ; la personne la confirme ; il
 *   l'exécute. C'est le plus haut niveau ouvert aujourd'hui.
 * - **Automatique** : il agirait seul, sur des actions sûres et explicitement autorisées.
 *   Fermé. Il n'existe aucun chemin, dans le code, par lequel un agent modifie un budget,
 *   une campagne ou un site sans confirmation — et cet écran ne fait que le dire.
 *
 * Rien n'est stocké ici : le niveau se déduit de ce qui existe déjà — le mode de chaque
 * compte publicitaire, choisi chez Naya ou chez MIRA, et l'interrupteur d'exploitation qui
 * ouvre ou ferme l'écriture pour toute l'installation. Un niveau affiché « Assisté » alors
 * que l'écriture est fermée serait une promesse que le produit ne tient pas.
 */

export type Niveau = 'conseil' | 'assiste'

export type AutonomieAgent = {
  agent: VisibilityAgentId
  niveau: Niveau
  /** Pourquoi ce niveau, en une phrase. */
  pourquoi: string
  /** Où le changer, quand il se change. */
  reglable: boolean
}

export async function lireAutonomie(userId: string): Promise<AutonomieAgent[]> {
  const [google, meta, ecritureGoogle, ecritureMeta] = await Promise.all([
    compteActif(userId, 'google-ads').catch(() => null),
    compteActif(userId, 'meta-ads').catch(() => null),
    isEnabled('publiciteEcriture').catch(() => false),
    isEnabled('publiciteEcritureMeta').catch(() => false),
  ])

  const publicitaire = (
    agent: 'ads' | 'meta',
    compte: { mode: string } | null,
    ecriture: boolean,
    nom: string,
  ): AutonomieAgent => {
    if (compte === null) {
      return { agent, niveau: 'conseil', pourquoi: `Aucun compte ${nom} relié.`, reglable: false }
    }
    if (!ecriture) {
      return {
        agent,
        niveau: 'conseil',
        pourquoi: `L’envoi de modifications vers ${nom} n’est pas ouvert sur cette installation : l’agent lit et recommande.`,
        reglable: false,
      }
    }
    return compte.mode === 'assiste'
      ? {
          agent,
          niveau: 'assiste',
          pourquoi: 'Il prépare chaque modification ; rien ne part sans votre confirmation, et tout se défait.',
          reglable: true,
        }
      : { agent, niveau: 'conseil', pourquoi: 'Vous avez choisi la lecture seule pour ce compte.', reglable: true }
  }

  return [
    { agent: 'oria', niveau: 'conseil', pourquoi: 'Elle classe et recommande ; elle transmet à un spécialiste quand vous le lui demandez.', reglable: false },
    { agent: 'seo', niveau: 'assiste', pourquoi: 'Il rédige les corrections ; elles ne partent vers la boutique qu’après votre validation.', reglable: false },
    { agent: 'content', niveau: 'assiste', pourquoi: 'Il rédige les articles ; ils sont déposés en brouillon, jamais publiés sans vous.', reglable: false },
    publicitaire('ads', google, ecritureGoogle, 'Google Ads'),
    publicitaire('meta', meta, ecritureMeta, 'Meta Ads'),
  ]
}
