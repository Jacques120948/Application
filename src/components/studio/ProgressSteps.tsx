import type { AppSpec } from '@/server/spec/schema'
import type { CheckReport } from '@/server/spec/checks'

/** Progression permanente demandée à la section 4 du cahier des charges. */
export function ProgressSteps({
  spec,
  report,
  published,
  tested,
}: {
  spec: AppSpec
  report: CheckReport
  published: boolean
  tested: boolean
}) {
  const steps = [
    { label: 'Idée', done: spec.description.trim().length > 0 },
    { label: 'Design', done: true },
    { label: 'Fonctionnalités', done: spec.pages.length > 1 },
    { label: 'Tests', done: tested && report.counts.error === 0 },
    // Une application gratuite a bien un modèle économique : c'est un choix, qui se
    // considère arrêté une fois l'application mise en ligne.
    {
      label: 'Monétisation',
      done:
        spec.monetization.model === 'free' ? published : spec.monetization.plans.length > 0,
    },
    { label: 'Publication', done: published },
  ]

  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 p-0 text-sm list-none m-0">
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-1.5">
          <span aria-hidden>{step.done ? '✅' : '⏳'}</span>
          <span className={step.done ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-soft)]'}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  )
}
