/**
 * Ce qu'une entreprise peut chercher, et qui dans l'équipe y travaille.
 *
 * Ici plutôt que sur le serveur, parce que le formulaire des objectifs en a besoin pour
 * s'afficher et qu'un composant de navigateur ne peut pas importer une valeur du serveur.
 * Le serveur revalide contre la même liste : une valeur de navigateur est une demande,
 * pas un droit.
 *
 * **Un objectif n'est proposé que si quelqu'un peut y travailler.** Il ne suffit pas qu'il
 * soit légitime : « faire croître les réseaux sociaux » l'est, mais aucun agent d'Evoliia
 * ne voit aujourd'hui un réseau social, et le choisir ne changerait rien au classement. Le
 * proposer ferait croire à une prise en compte qui n'existe pas. Il figure dans la liste,
 * grisé, avec la raison — la personne voit qu'on l'a entendue, et pourquoi on ne peut pas
 * encore.
 */

export type IdObjectif =
  | 'ventes'
  | 'leads'
  | 'rentabilite-pub'
  | 'trafic-seo'
  | 'visibilite-ia'
  | 'reseaux-sociaux'
  | 'panier-moyen'

export type Objectif = {
  id: IdObjectif
  label: string
  /** Les agents dont les constats remontent quand cet objectif est choisi. */
  agents: readonly string[]
  /** Vide : disponible. Sinon, pourquoi pas encore. */
  indisponible: string
}

export const OBJECTIFS: readonly Objectif[] = [
  {
    id: 'ventes',
    label: 'Augmenter les ventes',
    agents: ['cro', 'ads', 'meta'],
    indisponible: '',
  },
  {
    id: 'leads',
    label: 'Obtenir davantage de demandes de contact',
    agents: ['cro', 'ads', 'meta'],
    indisponible: '',
  },
  {
    id: 'rentabilite-pub',
    label: 'Rentabiliser la publicité',
    agents: ['ads', 'meta'],
    indisponible: '',
  },
  {
    id: 'trafic-seo',
    label: 'Augmenter le trafic depuis Google',
    agents: ['seo', 'content', 'audit'],
    indisponible: '',
  },
  {
    id: 'visibilite-ia',
    label: 'Être repris par les assistants IA',
    agents: ['geo', 'content'],
    indisponible: '',
  },
  {
    id: 'reseaux-sociaux',
    label: 'Faire croître les réseaux sociaux',
    agents: [],
    indisponible: 'Aucun agent ne lit encore vos réseaux sociaux. Arrivera avec Postelya.',
  },
  {
    id: 'panier-moyen',
    label: 'Augmenter le panier moyen',
    agents: [],
    indisponible:
      'Aucune donnée de commande n’est encore reliée : Oria ne saurait pas dire si ça bouge.',
  },
]

/** Deux au plus. Au-delà, tout redevient prioritaire, et rien ne l'est plus. */
export const OBJECTIFS_MAX = 2

export const ACTIVITES = ['boutique', 'services'] as const

export type Activite = (typeof ACTIVITES)[number]

export function objectif(id: string): Objectif | undefined {
  return OBJECTIFS.find((un) => un.id === id)
}

/**
 * Combien chaque agent pèse selon les objectifs déclarés.
 *
 * Le premier objectif double le poids de ses agents, le second le multiplie par une fois
 * et demie. Un agent concerné par les deux garde le plus fort des deux : les multiplier
 * l'un par l'autre ferait écraser tout le reste par un seul agent.
 *
 * Ce n'est qu'une inclinaison. Une panne reste critique quel que soit l'objectif, et le
 * classement le garantit : l'urgence y pèse quatre fois, l'objectif deux au plus.
 */
export function biaisDesObjectifs(ids: readonly string[]): Record<string, number> {
  const biais: Record<string, number> = {}
  const forces = [2, 1.5]
  ids.slice(0, OBJECTIFS_MAX).forEach((id, rang) => {
    const trouve = objectif(id)
    if (trouve === undefined || trouve.indisponible !== '') return
    for (const agent of trouve.agents) {
      biais[agent] = Math.max(biais[agent] ?? 1, forces[rang] ?? 1)
    }
  })
  return biais
}
