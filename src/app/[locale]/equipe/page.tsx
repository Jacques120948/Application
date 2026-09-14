import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { listProjects } from '@/server/projects/service'
import { AGENTS } from '@/server/agents/catalog'
import { Shell } from '@/components/studio/Shell'
import { TeamRoster } from '@/components/studio/TeamRoster'
import { Card, CardBody, LinkButton } from '@/components/ui'

/**
 * L'entrée « Équipe marketing » de la navigation.
 *
 * L'équipe parle toujours d'un projet : cette adresse mène à l'équipe de l'application en
 * ligne s'il y en a une — c'est là qu'elle a des données à lire — sinon à celle du projet
 * le plus récent, où l'on peut changer de projet. Sans aucun projet, elle présente les
 * trois spécialistes et ce qui les ouvre, puis invite à créer un premier projet : une
 * équipe sans projet n'aurait rien à regarder, et l'écran le dit plutôt que de le cacher.
 */
export default async function TeamEntryPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const projects = await listProjects(user.id)
  const target = projects.find((project) => project.status === 'PUBLISHED') ?? projects[0]
  if (target !== undefined) redirect(`/${locale}/projets/${target.id}/equipe`)

  const [wallet, entitlements] = await Promise.all([getWallet(user.id), getEntitlements(user.id)])
  const members = AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    avatar: agent.avatar,
    open: entitlements.granted.includes(agent.feature),
    availableWith:
      entitlements.locked.find((entry) => entry.feature.id === agent.feature)?.availableWith ?? null,
  }))

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="equipe"
    >
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">Votre équipe marketing</h1>
        <p className="mb-8 text-[var(--color-ink-soft)]">
          Trois spécialistes IA qui lisent les données réelles d’un projet et le disent quand
          elles manquent. Ils se mettent au travail dès qu’un projet existe.
        </p>
        <Card>
          <CardBody className="grid gap-5">
            <TeamRoster members={members} />
            <div className="flex flex-wrap items-center gap-3">
              <LinkButton href={`/${locale}/creer`}>Créer mon premier projet</LinkButton>
              <LinkButton href={`/${locale}/idees`} variant="secondary">
                Partir d’une idée
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
