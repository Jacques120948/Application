import { z } from 'zod'
import { askCoach } from '@/server/ai/operations'
import { listProjects } from '@/server/projects/service'
import { getCreatorOverview } from './overview'

/**
 * Coach du créateur.
 *
 * Sa valeur tient entièrement à une chose : il sait où en est la personne. Un coach qui
 * répondrait dans le vide proposerait de définir un objectif déjà défini, ou de construire
 * alors que l'idée n'est pas choisie. L'état est donc calculé ici, à partir des faits, et
 * transmis au modèle comme une donnée.
 *
 * Le coût est d'un crédit par question, débité du créateur comme toute opération qui
 * appelle le modèle. C'est écrit dans l'interface avant qu'il ne pose sa question.
 */

/** Écrans d'où la question peut venir. Sert à situer la personne, rien de plus. */
const SCREENS = [
  'visibilite',
  'demarrer',
  'objectif',
  'idees',
  'idee',
  'creer',
  'projet',
  'dashboard',
  'atelier',
  'autre',
] as const

export const coachInput = z.object({
  question: z.string().trim().min(3).max(600),
  screen: z.enum(SCREENS).default('autre'),
  history: z
    .array(
      z.object({
        question: z.string().max(600),
        answer: z.string().max(2000),
      }),
    )
    .max(4)
    .default([]),
})

export type CoachInput = z.infer<typeof coachInput>

const SCREEN_LABEL: Record<(typeof SCREENS)[number], string> = {
  visibilite: 'tableau de bord de la visibilité : les deux notes et le plan d’action',
  demarrer: 'écran du choix de départ',
  objectif: "formulaire de l'objectif",
  idees: 'liste des idées proposées',
  idee: "fiche d'étude d'une idée",
  creer: "description directe d'une idée",
  projet: "éditeur d'une application",
  dashboard: 'tableau de bord',
  atelier: "atelier du constructeur d'applications",
  autre: 'autre page',
}

export async function helpCreator(
  userId: string,
  input: CoachInput,
  locale: string,
): Promise<{ answer: string; creditsSpent: number }> {
  const [overview, projects] = await Promise.all([
    getCreatorOverview(userId, locale),
    listProjects(userId),
  ])

  const situation = [
    `Écran actuel : ${SCREEN_LABEL[input.screen]}.`,
    overview.objective === null
      ? "Objectif : pas encore défini. Cette personne n'est pas passée par le parcours guidé, ou pas encore."
      : `Objectif : ${overview.objective.monthlyGoalLabel}.`,
    overview.objective?.ideaTitle == null
      ? 'Idée retenue : aucune pour le moment.'
      : `Idée retenue : ${overview.objective.ideaTitle}.`,
    `Idées reçues : ${overview.ideaCount}.`,
    `Applications créées : ${projects.length}${
      projects.length === 0 ? '' : ` (${projects.map((project) => project.name).join(', ')})`
    }.`,
    `Étapes franchies : ${
      overview.journey.steps
        .filter((step) => step.done)
        .map((step) => step.label)
        .join(', ') || 'aucune'
    }.`,
    overview.journey.next === null
      ? 'Prochaine étape : tout est fait, il reste à trouver des clients.'
      : `Prochaine étape : ${overview.journey.next.label} — ${overview.journey.next.why}`,
  ].join('\n')

  return askCoach({
    userId,
    question: input.question,
    situation,
    history: input.history,
    locale,
  })
}
