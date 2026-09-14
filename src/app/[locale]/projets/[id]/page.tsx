import { notFound, redirect } from 'next/navigation'
import { env } from '@/lib/env'
import { resolveLocale } from '@/i18n'
import { AppError } from '@/lib/errors'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEffectivePlan } from '@/server/billing/plans'
import { isAiAvailable } from '@/server/ai/client'
import { getProject, listChatMessages } from '@/server/projects/service'
import { AGENTS } from '@/server/agents/catalog'
import { Shell } from '@/components/studio/Shell'
import { TeamAvatars } from '@/components/studio/TeamAvatars'
import { ProjectWorkspace } from '@/components/studio/ProjectWorkspace'
import { isEnabled } from '@/server/settings/flags'
import { FAQ_ESTIMATED_CREDITS } from '@/server/support/knowledge'
import { INSIGHTS_ESTIMATED_CREDITS } from '@/server/support/insights'
import { LinkButton } from '@/components/ui'

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ onglet?: string }>
}) {
  const { locale: rawLocale, id } = await params
  const { onglet } = await searchParams
  const locale = resolveLocale(rawLocale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  let project
  try {
    project = await getProject(user.id, id)
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound()
    throw error
  }

  const [messages, wallet, plan, liaV2] = await Promise.all([
    listChatMessages(user.id, id),
    getWallet(user.id),
    getEffectivePlan(user.id),
    isEnabled('liaV2'),
  ])

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="projet">
      {/*
        Une application construite n'est pas une application connue. L'invitation
        n'apparaît qu'une fois le projet en ligne : proposer de préparer un lancement
        avant qu'il y ait quelque chose à lancer serait une étape de plus, pas une aide.
      */}
      {project.publishedAt === null ? null : (
        <div className="mx-auto mb-6 flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <p className="m-0 text-sm">
            <span className="font-medium">Votre application est en ligne.</span>{' '}
            <span className="text-[var(--color-ink-soft)]">
              Préparons maintenant son lancement.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/${locale}/projets/${project.id}/marketing`}>
              Préparer mon lancement
            </LinkButton>
            <LinkButton
              href={`/${locale}/projets/${project.id}/equipe`}
              variant="secondary"
            >
              <TeamAvatars people={AGENTS} size="small" />
              <span className="ml-2">Voir mon équipe marketing</span>
            </LinkButton>
          </div>
        </div>
      )}

      {/*
        Emporter son travail. Les deux téléchargements sont des liens ordinaires plutôt
        qu'un bouton avec du JavaScript : le navigateur sait déjà enregistrer un fichier,
        et une archive de plusieurs mégaoctets n'a rien à faire en mémoire dans un onglet.
      */}
      {plan.allowExport || plan.allowMobilePrep ? (
        <div className="mx-auto mb-6 flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <p className="m-0 text-sm">
            <span className="font-medium">Emporter votre travail.</span>{' '}
            <span className="text-[var(--color-ink-soft)]">
              Vos pages, vos images et vos données, dans un dossier qui s’ouvre sans nous.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {plan.allowExport ? (
              <a
                href={`/api/projects/${project.id}/export`}
                className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] no-underline transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand-strong)]"
              >
                Télécharger mon site
              </a>
            ) : null}
            {plan.allowMobilePrep ? (
              <a
                href={`/api/projects/${project.id}/mobile`}
                className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] no-underline transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand-strong)]"
              >
                Dossier pour les boutiques
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      <ProjectWorkspace
        projectId={project.id}
        locale={locale}
        initialSpec={project.spec}
        initialReport={project.report}
        initialMessages={messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        }))}
        publishedUrl={
          project.publishedAt === null
            ? null
            : `${env.appUrl.replace(/\/$/, '')}/a/${project.slug}`
        }
        aiAvailable={isAiAvailable()}
        alreadyTested={project.hasBeenTested}
        initialTab={onglet === 'support' ? 'support' : 'assistant'}
        support={{ liaV2, faqCredits: FAQ_ESTIMATED_CREDITS, insightsCredits: INSIGHTS_ESTIMATED_CREDITS }}
      />
    </Shell>
  )
}
