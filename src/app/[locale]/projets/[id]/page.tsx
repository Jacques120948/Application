import { notFound, redirect } from 'next/navigation'
import { env } from '@/lib/env'
import { resolveLocale } from '@/i18n'
import { AppError } from '@/lib/errors'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { isAiAvailable } from '@/server/ai/client'
import { getProject, listChatMessages } from '@/server/projects/service'
import { Shell } from '@/components/studio/Shell'
import { ProjectWorkspace } from '@/components/studio/ProjectWorkspace'
import { LinkButton } from '@/components/ui'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale: rawLocale, id } = await params
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

  const [messages, wallet] = await Promise.all([
    listChatMessages(user.id, id),
    getWallet(user.id),
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
              Voir mon équipe marketing
            </LinkButton>
          </div>
        </div>
      )}
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
      />
    </Shell>
  )
}
