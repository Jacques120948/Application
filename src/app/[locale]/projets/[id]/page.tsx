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
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}>
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
