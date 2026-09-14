import { notFound, redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { AppError } from '@/lib/errors'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getProject, listProjects } from '@/server/projects/service'
import { getDesk, SPECIALIST_ESTIMATED_CREDITS } from '@/server/agents/service'
import { Shell } from '@/components/studio/Shell'
import { TeamBoard } from '@/components/studio/TeamBoard'
import { ProjectSwitcher } from '@/components/studio/ProjectSwitcher'

/**
 * Votre équipe marketing.
 *
 * Trois métiers regardent le même projet : les réseaux sociaux, le référencement, la
 * lecture des résultats. Chacun ne voit que ce qui le concerne, et ne parle que de faits
 * constatés dans le projet — ce qui le distingue d'un assistant généraliste, qui donnerait
 * des conseils de manuel au prix d'un crédit.
 */
export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale: rawLocale, id } = await params
  const locale = resolveLocale(rawLocale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  try {
    await getProject(user.id, id)
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound()
    throw error
  }

  const [wallet, desk, projects] = await Promise.all([
    getWallet(user.id),
    getDesk(user.id, id),
    listProjects(user.id),
  ])

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="projet"
    >
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">Votre équipe marketing</h1>
        <p className="mb-6 text-[var(--color-ink-soft)]">
          Trois métiers, un seul projet à la fois : {desk.projectName}. Chacun lit vos données
          réelles et le dit quand elles manquent.
        </p>

        {/*
          Le projet se choisit ici, pas dans la question : un spécialiste ne lit qu'un
          projet, et l'adresse de la page dit lequel. Avec un seul projet, la liste n'a
          rien à offrir et n'apparaît pas.
        */}
        {projects.length > 1 ? (
          <div className="mb-8 max-w-md">
            <ProjectSwitcher
              projects={projects.map((project) => ({ id: project.id, name: project.name, status: project.status }))}
              currentId={id}
              hrefTemplate={`/${locale}/projets/{id}/equipe`}
              label="Projet dont parle l’équipe"
              hint="Les questions et les réponses restent attachées au projet choisi."
            />
          </div>
        ) : null}

        <TeamBoard
          projectId={id}
          agents={desk.agents}
          initialNotes={desk.notes}
          credits={wallet.balance}
          estimatedCredits={SPECIALIST_ESTIMATED_CREDITS}
          teamEnabled={desk.teamEnabled}
        />
      </div>
    </Shell>
  )
}
