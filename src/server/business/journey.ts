import type { AppSpec } from '@/server/spec/schema'
import type { CheckReport } from '@/server/spec/checks'

/**
 * Parcours du créateur : où il en est, ce qu'il doit faire ensuite, et pourquoi.
 *
 * Répond aux trois questions que l'interface doit toujours pouvoir traiter (exigence 14).
 * L'état est **calculé à partir des faits** — un profil existe, une idée est validée, une
 * version a été publiée — et non stocké dans une colonne. Un état dérivé ne peut pas se
 * désynchroniser de la réalité.
 */

export type JourneyStepId =
  | 'objectif'
  | 'idee'
  | 'validation'
  | 'construction'
  | 'test'
  | 'monetisation'
  | 'publication'

export type JourneyStep = {
  id: JourneyStepId
  label: string
  done: boolean
  /**
   * Étape sans objet pour ce parcours. Un créateur qui arrive avec sa propre idée n'a
   * pas d'idée proposée à faire analyser : laisser l'étape en attente indéfiniment
   * donnerait une prochaine action absurde une fois l'application déjà construite.
   */
  skipped?: boolean
  /** Pourquoi cette étape existe, en une phrase compréhensible par un débutant. */
  why: string
  /** Action à faire, quand l'étape n'est pas franchie. */
  action?: string
  href?: string
}

export type Journey = {
  steps: JourneyStep[]
  progress: number
  next: JourneyStep | null
}

export type JourneyFacts = {
  locale: string
  hasProfile: boolean
  /** Vrai quand le créateur est passé par le parcours guidé plutôt que par sa propre idée. */
  guidedPath: boolean
  hasIdea: boolean
  ideaValidated: boolean
  projectId: string | null
  hasBuild: boolean
  testedWithoutError: boolean
  monetizationDecided: boolean
  published: boolean
}

export function computeJourney(facts: JourneyFacts): Journey {
  const base = `/${facts.locale}`
  const project = facts.projectId === null ? null : `${base}/projets/${facts.projectId}`
  // Le créateur venu avec sa propre idée saute la recherche et l'analyse d'idée.
  const ownIdea = !facts.guidedPath && facts.hasBuild

  const steps: JourneyStep[] = [
    {
      id: 'objectif',
      label: 'Définir votre objectif',
      done: facts.hasProfile,
      why: "C'est lui qui oriente les idées proposées, le modèle économique et le prix.",
      action: 'Répondre à quelques questions',
      href: `${base}/objectif`,
    },
    {
      id: 'idee',
      label: 'Choisir une idée',
      done: facts.hasIdea,
      ...(ownIdea ? { skipped: true } : {}),
      why: 'Mieux vaut partir d’une idée adaptée à votre profil que de construire au hasard.',
      action: 'Voir les idées proposées',
      href: `${base}/idees`,
    },
    {
      id: 'validation',
      label: 'Faire analyser l’idée',
      done: facts.ideaValidated,
      ...(ownIdea ? { skipped: true } : {}),
      why: 'Pour éviter de construire quelque chose que personne n’achètera.',
      action: 'Lancer l’analyse',
      href: `${base}/idees`,
    },
    {
      id: 'construction',
      label: 'Construire l’application',
      done: facts.hasBuild,
      why: 'Une première version réellement utilisable vaut mieux qu’un long cahier des charges.',
      action: 'Créer l’application',
      href: `${base}/idees`,
    },
    {
      id: 'test',
      label: 'Tester l’application',
      done: facts.testedWithoutError,
      why: 'Pour corriger ce qui bloque avant que vos premiers clients ne le découvrent.',
      action: 'Lancer le test',
      href: project ?? `${base}/dashboard`,
    },
    {
      id: 'monetisation',
      label: 'Décider comment gagner de l’argent',
      done: facts.monetizationDecided,
      why: 'Un prix affiché clairement change tout pour vos premiers clients.',
      action: 'Régler la monétisation',
      href: project ?? `${base}/dashboard`,
    },
    {
      id: 'publication',
      label: 'Mettre en ligne',
      done: facts.published,
      why: 'Tant que l’application n’est pas en ligne, personne ne peut l’essayer.',
      action: 'Publier',
      href: project ?? `${base}/dashboard`,
    },
  ]

  const settled = steps.filter((step) => step.done || step.skipped === true).length
  return {
    steps,
    progress: Math.round((settled / steps.length) * 100),
    next: steps.find((step) => !step.done && step.skipped !== true) ?? null,
  }
}

/** Traduit l'état d'un projet en faits de parcours. */
export function projectFacts(params: {
  locale: string
  hasProfile: boolean
  guidedPath: boolean
  ideaValidated: boolean
  projectId: string
  spec: AppSpec
  report: CheckReport
  hasBeenTested: boolean
  published: boolean
}): JourneyFacts {
  const monetization = params.spec.monetization
  return {
    locale: params.locale,
    hasProfile: params.hasProfile,
    guidedPath: params.guidedPath,
    hasIdea: true,
    ideaValidated: params.ideaValidated,
    projectId: params.projectId,
    hasBuild: true,
    testedWithoutError: params.hasBeenTested && params.report.counts.error === 0,
    // Une application gratuite est un choix assumé, qui se considère arrêté une fois en ligne.
    monetizationDecided:
      monetization.model === 'free' ? params.published : monetization.plans.length > 0,
    published: params.published,
  }
}
