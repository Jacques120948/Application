import { decalageDansLaPeriode } from '@/server/audit/calendrier'
import type { VisibilityAgentId } from '@/server/agents/visibility'
import type { Signal } from './signaux'

/**
 * Le plan d'Oria : aujourd'hui, cette semaine, ce mois.
 *
 * Il est tiré des priorités déjà classées, par une règle écrite ici et nulle part
 * ailleurs. Aucun modèle n'intervient : un plan qui changerait à chaque ouverture ne
 * serait pas un plan.
 *
 * **Le moment dépend de l'urgence et de l'effort, pas du rang seul.** Une panne va
 * aujourd'hui quoi qu'il arrive. Ce qui se règle en une modification passe aujourd'hui ou
 * cette semaine. Ce qui demande de produire quelque chose — des avis, une politique de
 * retour, une page — va au mois, même s'il est bien classé : le mettre « aujourd'hui »
 * serait promettre une journée qu'on n'a pas.
 *
 * **On ne remplit pas.** Le cahier des charges le dit mieux que nous : ne pas générer
 * cinq tâches si trois suffisent. Chaque période a un plafond, jamais un plancher. Une
 * semaine avec une seule chose à faire affiche une seule chose.
 *
 * **Chaque action a un responsable.** Aujourd'hui, c'est toujours la personne, aidée du
 * spécialiste qui a relevé le point : c'est elle qui décide, lui qui prépare. Le type
 * prévoit déjà un collaborateur, pour le jour où un compte en aura plusieurs.
 */

/** Plafonds par période. Des plafonds, jamais des objectifs à atteindre. */
export const PLAFONDS = { aujourdhui: 2, semaine: 3, mois: 3 } as const

/**
 * Jusqu'où le plan regarde dans la liste classée.
 *
 * Au-delà du dixième point, un constat est trop loin pour mériter une place dans le mois :
 * il attendra que les premiers soient réglés et qu'il remonte de lui-même.
 */
const HORIZON = 10

/** Les priorités affichées en tête du cockpit : c'est parmi elles que se choisit la journée. */
const PRIORITES_TETE = 3

export type Responsable =
  | { type: 'utilisateur' }
  | { type: 'collaborateur'; id: string; nom: string }

export type ActionPlan = {
  signal: Signal
  /** Qui décide et fait. */
  responsable: Responsable
  /** Qui prépare : les spécialistes qui ont relevé le point. */
  aide: readonly VisibilityAgentId[]
}

export type PlanMarketing = {
  aujourdhui: ActionPlan[]
  semaine: ActionPlan[]
  mois: ActionPlan[]
}

function action(signal: Signal): ActionPlan {
  return { signal, responsable: { type: 'utilisateur' }, aide: signal.sources }
}

/**
 * Le plan, à partir des signaux dans l'ordre du classement.
 *
 * Fonction pure : elle range, elle ne lit rien. C'est ce qui permet de l'éprouver sur les
 * cas qui comptent — la liste vide, la semaine creuse — sans base de données.
 */
export function construirePlan(signaux: readonly Signal[]): PlanMarketing {
  const vus = new Set<string>()
  const prendre = (signal: Signal): ActionPlan => {
    vus.add(signal.cle)
    return action(signal)
  }
  const restants = () => signaux.slice(0, HORIZON).filter((signal) => !vus.has(signal.cle))

  /*
   * Aujourd'hui : ce qui brûle. Si rien ne brûle, la première des trois priorités qui se
   * règle vite, et à défaut la première tout court.
   *
   * « Des trois priorités », et pas de toute la liste : une première version allait
   * chercher la correction rapide où qu'elle soit, et proposait pour la journée un
   * sixième point sans rapport avec l'objectif choisi, pendant que la priorité numéro un
   * attendait. Une chose rapide mais secondaire n'est pas ce qu'on fait en premier.
   */
  const aujourdhui: ActionPlan[] = []
  for (const signal of restants()) {
    if (aujourdhui.length >= PLAFONDS.aujourdhui) break
    if (signal.urgence === 'critique') aujourdhui.push(prendre(signal))
  }
  if (aujourdhui.length === 0) {
    const tete = restants().slice(0, PRIORITES_TETE)
    const rapide = tete.find((signal) => signal.effort === 'faible') ?? tete[0]
    if (rapide !== undefined) aujourdhui.push(prendre(rapide))
  }

  const semaine: ActionPlan[] = []
  for (const signal of restants()) {
    if (semaine.length >= PLAFONDS.semaine) break
    if (signal.effort !== 'eleve') semaine.push(prendre(signal))
  }

  const mois: ActionPlan[] = []
  for (const signal of restants()) {
    if (mois.length >= PLAFONDS.mois) break
    mois.push(prendre(signal))
  }

  return { aujourdhui, semaine, mois }
}

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'] as const

export type JourSemaine = { jour: (typeof JOURS)[number]; actions: ActionPlan[] }

/**
 * « Ma semaine avec Oria » : les actions de la semaine réparties sur les jours ouvrés.
 *
 * La répartition est celle du calendrier éditorial, pour la même raison : tout poser le
 * lundi laisse quatre jours vides et un lundi impossible. Trois actions tombent le lundi,
 * le mercredi et le jeudi ; une seule, le lundi. Les jours sans action ne s'affichent pas :
 * on n'invente pas une tâche pour que le vendredi ait l'air occupé.
 *
 * Ce qui est prévu aujourd'hui ouvre la semaine, le lundi. Le plan étant recalculé à
 * chaque ouverture, « lundi » veut dire « en premier » plutôt qu'une date : si l'on ouvre
 * l'écran un mercredi, ce qui reste se lit dans l'ordre.
 */
export function maSemaine(plan: PlanMarketing): JourSemaine[] {
  const aPlacer = [...plan.aujourdhui, ...plan.semaine]
  const parJour = new Map<number, ActionPlan[]>()
  aPlacer.forEach((uneAction, rang) => {
    const jour = Math.min(JOURS.length - 1, decalageDansLaPeriode(rang, aPlacer.length, JOURS.length))
    parJour.set(jour, [...(parJour.get(jour) ?? []), uneAction])
  })
  return [...parJour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([jour, actions]) => ({ jour: JOURS[jour] ?? 'Lundi', actions }))
}
