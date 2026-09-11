import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale, type MessageKey } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { listProjects } from '@/server/projects/service'
import { Badge, Card, CardBody, EmptyState, LinkButton } from '@/components/ui'
import { Shell } from '@/components/studio/Shell'

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const t = getTranslator(locale)
  const [projects, wallet] = await Promise.all([listProjects(user.id), getWallet(user.id)])

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}>
      <div className="mb-7 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
        <LinkButton href={`/${locale}/creer`} className="ml-auto">
          {t('dashboard.create')}
        </LinkButton>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title={t('dashboard.empty')}
          body={t('dashboard.emptyBody')}
          action={
            <LinkButton href={`/${locale}/creer`} size="large">
              {t('dashboard.create')}
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <a
              key={project.id}
              href={`/${locale}/projets/${project.id}`}
              className="no-underline"
            >
              <Card className="h-full transition-colors hover:border-[var(--color-ink-faint)]">
                <div
                  className="h-20 rounded-t-[var(--radius-card)]"
                  style={{ background: project.themeColor }}
                  aria-hidden
                />
                <CardBody>
                  <div className="flex items-start gap-3">
                    <h2 className="m-0 text-base font-semibold text-[var(--color-ink)]">
                      {project.name}
                    </h2>
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
                  {project.readyScore !== null ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {t('publish.readyPercent', { percent: project.readyScore })}
                    </p>
                  ) : null}
                </CardBody>
              </Card>
            </a>
          ))}
        </div>
      )}
    </Shell>
  )
}
