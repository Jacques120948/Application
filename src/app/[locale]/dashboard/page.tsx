import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale, type MessageKey } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { listProjects } from '@/server/projects/service'
import { getCreatorOverview } from '@/server/business/overview'
import { OBJECTIVE_DISCLAIMER } from '@/server/business/economics'
import { Badge, Card, CardBody, LinkButton } from '@/components/ui'
import { Shell } from '@/components/studio/Shell'

/**
 * Tableau de bord.
 *
 * Il ne liste pas d'abord des applications : il répond d'abord à « où j'en suis et que
 * dois-je faire ensuite ». La liste des applications vient après, quand elle existe.
 */
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const overview = await getCreatorOverview(user.id, locale)
  // Sans objectif, le parcours ne peut pas commencer : on y emmène directement.
  if (overview.objective === null) redirect(`/${locale}/objectif`)

  const t = getTranslator(locale)
  const [projects, wallet] = await Promise.all([listProjects(user.id), getWallet(user.id)])
  const next = overview.journey.next

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}>
      <div className="grid gap-6">
        <Card>
          <CardBody>
            <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-4 sm:grid-cols-2">
                <Figure label="Mon objectif" value={overview.objective.monthlyGoalLabel} />
                <Figure
                  label="Mon projet"
                  value={overview.objective.ideaTitle ?? 'Pas encore choisi'}
                />
                <Figure
                  label="Opportunité"
                  value={
                    overview.objective.opportunityScore === null
                      ? '—'
                      : `${overview.objective.opportunityScore}/100`
                  }
                />
                <Figure
                  label="Clients pour l’objectif"
                  value={
                    overview.objective.customersNeeded === null
                      ? '—'
                      : `environ ${overview.objective.customersNeeded}`
                  }
                />
              </div>

              <div className="sm:w-56">
                <p className="m-0 text-sm text-[var(--color-ink-soft)]">Avancement</p>
                <p className="m-0 text-3xl font-semibold">{overview.journey.progress} %</p>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-canvas)]"
                  role="progressbar"
                  aria-valuenow={overview.journey.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-[var(--color-brand)]"
                    style={{ width: `${overview.journey.progress}%` }}
                  />
                </div>
              </div>
            </div>

            {overview.objective.sentence !== null ? (
              <p className="mt-5 text-sm text-[var(--color-ink-soft)]">
                {overview.objective.sentence}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{OBJECTIVE_DISCLAIMER}</p>
          </CardBody>

          <div className="border-t border-[var(--color-line)] px-5 py-4">
            {next === null ? (
              <p className="m-0 text-sm font-medium text-[var(--color-positive)]">
                Votre application est en ligne. Prochaine étape : trouver vos premiers clients.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <p className="m-0 text-sm text-[var(--color-ink-soft)]">Prochaine étape</p>
                  <p className="m-0 font-medium">{next.label}</p>
                  <p className="m-0 mt-0.5 text-sm text-[var(--color-ink-soft)]">{next.why}</p>
                </div>
                <LinkButton href={next.href ?? `/${locale}/idees`} size="large" className="ml-auto">
                  {next.action ?? 'Continuer'}
                </LinkButton>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardBody>
            <h2 className="mt-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
              Votre parcours
            </h2>
            <ol className="mt-3 grid gap-2 p-0 text-sm list-none">
              {overview.journey.steps.map((step) => (
                <li key={step.id} className="flex items-start gap-2">
                  <span aria-hidden>{step.done ? '✅' : '⏳'}</span>
                  <span className={step.done ? '' : 'text-[var(--color-ink-soft)]'}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        {projects.length > 0 ? (
          <section>
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <h2 className="m-0 text-lg font-semibold">{t('dashboard.title')}</h2>
              <LinkButton href={`/${locale}/idees`} variant="secondary" className="ml-auto">
                Voir mes idées
              </LinkButton>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <a key={project.id} href={`/${locale}/projets/${project.id}`} className="no-underline">
                  <Card className="h-full transition-colors hover:border-[var(--color-ink-faint)]">
                    <div
                      className="h-20 rounded-t-[var(--radius-card)]"
                      style={{ background: project.themeColor }}
                      aria-hidden
                    />
                    <CardBody>
                      <div className="flex items-start gap-3">
                        <h3 className="m-0 text-base font-semibold text-[var(--color-ink)]">
                          {project.name}
                        </h3>
                        <span className="ml-auto">
                          <Badge tone={project.status === 'PUBLISHED' ? 'positive' : 'neutral'}>
                            {t(`status.${project.status}` as MessageKey)}
                          </Badge>
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                        {t('dashboard.lastEdited')}{' '}
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(project.updatedAt)}
                      </p>
                    </CardBody>
                  </Card>
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-sm text-[var(--color-ink-soft)]">{label}</p>
      <p className="m-0 mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  )
}
