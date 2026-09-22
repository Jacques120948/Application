/**
 * Ce qu'un agent publicitaire a le droit de faire sur un compte.
 *
 * Trois niveaux, un seul endroit où ils sont nommés. L'écran les affiche, le serveur les
 * applique, et la base les stocke en clair dans `AdsAccount.mode` : trois endroits, une
 * seule liste. Les redéclarer de chaque côté créerait deux vérités, et le jour où l'une
 * changerait, l'écran proposerait un mode que le serveur ne reconnaîtrait pas — c'est-à-dire
 * un bouton qui ne fait rien et dont personne ne saurait dire pourquoi.
 *
 * Ce fichier vit dans `lib` et non dans `server` pour une raison mécanique : un composant de
 * navigateur ne peut pas importer une valeur depuis `@/server`, et l'écran qui laisse
 * choisir doit connaître les mêmes libellés que le garde-fou qui tranche.
 *
 * **Le défaut est le plus fermé.** Une autorisation OAuth donne le droit d'écrire ; elle ne
 * dit pas qu'on le souhaite. Un compte relié commence donc en lecture, et c'est un geste
 * séparé qui ouvre l'écriture.
 */

export const MODES_ADS = ['lecture', 'assiste', 'autopilote'] as const

export type ModeAds = (typeof MODES_ADS)[number]

export const MODE_PAR_DEFAUT: ModeAds = 'lecture'

/** Le mode recommandé, et celui que le produit met en avant. */
export const MODE_RECOMMANDE: ModeAds = 'assiste'

export function modeValide(valeur: unknown): ModeAds {
  return (MODES_ADS as readonly unknown[]).includes(valeur)
    ? (valeur as ModeAds)
    : MODE_PAR_DEFAUT
}

export const MODES_DITS: Record<ModeAds, { titre: string; resume: string }> = {
  lecture: {
    titre: 'Observateur',
    resume:
      'L’agent lit vos campagnes, les explique et vous conseille. Il ne peut rien modifier, même si vous le lui demandez.',
  },
  assiste: {
    titre: 'Assistant',
    resume:
      'L’agent prépare les modifications et vous les montre avec leur motif. Rien n’est envoyé à la plateforme tant que vous n’avez pas confirmé, une par une.',
  },
  autopilote: {
    titre: 'Pilote automatique',
    resume:
      'L’agent applique lui-même certains ajustements, dans les limites que vous fixez. Les gestes sensibles restent soumis à votre accord.',
  },
}

/**
 * Le pilote automatique est déclaré, et il n'est pas ouvert.
 *
 * Le vocabulaire est posé maintenant pour que la base, l'écran et le garde-fou parlent la
 * même langue dès le premier jour. La mécanique — les plafonds, la liste blanche de
 * campagnes, les types d'action autorisés — vient ensuite, et les colonnes qui la portent
 * sont toutes fermées par défaut.
 *
 * Tant que ce drapeau est faux, un compte en `autopilote` se comporte comme un compte en
 * lecture : le garde-fou refuse. C'est volontairement l'échec le plus fermé — un mode à
 * moitié branché qui laisserait passer des écritures sans vérifier ses propres bornes
 * serait pire que pas de mode du tout.
 */
export const AUTOPILOTE_OUVERT = false

/** Les modes qui peuvent aboutir à une écriture, compte tenu de ce qui est réellement livré. */
export function peutEcrire(mode: ModeAds): boolean {
  if (mode === 'assiste') return true
  return mode === 'autopilote' && AUTOPILOTE_OUVERT
}
