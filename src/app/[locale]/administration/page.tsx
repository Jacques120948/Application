import { notFound, redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getAdminOverview, listPlans, listUsers } from '@/server/admin/service'
import { Shell } from '@/components/studio/Shell'
import { Card, CardBody } from '@/components/ui'
import { AdminPlan, AdminUser, PlanEditor, UserTable } from '@/components/studio/AdminPanels'

/**
 * Back-office.
 *
 * L'accès est refusé par `listPlans` et consorts, qui appellent `requireAdmin`. Un compte
 * ordinaire obtient une page « introuvable », pas un message lui apprenant que cet écran
 * existe.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)
  // Page réellement introuvable pour un compte ordinaire : pas d'erreur serveur, et rien
  // qui laisse deviner l'existence du back-office. Les services revérifient ensuite.
  if (user.role !== 'ADMIN') notFound()

  const t = getTranslator(locale)
  const [overview, plans, users, wallet] = await Promise.all([
    getAdminOverview(),
    listPlans(),
    listUsers({ query: '', take: 50 }),
    getWallet(user.id),
  ])

  const figures = [
    { label: 'Comptes créés', value: overview.users },
    { label: 'Abonnements actifs', value: overview.subscriptions },
    { label: 'Applications en ligne', value: overview.publishedApps },
    { label: 'Offres visibles', value: overview.activePlans },
  ]

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}>
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">{t('nav.admin')}</h1>
        <p className="mb-7 text-[var(--color-ink-soft)]">
          Les prix, les limites et les offres se modifient ici. Plus besoin de passer par la
          base de données.
        </p>

        <div className="mb-10 grid gap-4 sm:grid-cols-4">
          {figures.map((figure) => (
            <Card key={figure.label}>
              <CardBody>
                <p className="m-0 text-2xl font-semibold">{figure.value}</p>
                <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">{figure.label}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        <h2 className="mb-1 text-lg font-semibold">Les offres</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Ce que vous changez ici s’applique immédiatement, sans redéploiement. L’export du
          code et la préparation pour mobile n’apparaissent pas : ils ne sont pas encore
          construits, donc aucune offre ne peut les promettre.
        </p>
        <PlanEditor plans={plans as unknown as AdminPlan[]} />

        <h2 className="mt-12 mb-1 text-lg font-semibold">Les comptes</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
          Les cinquante inscriptions les plus récentes. Attribuer une offre remplace la
          requête SQL qu’il fallait écrire à la main.
        </p>
        <UserTable users={users as AdminUser[]} plans={plans as unknown as AdminPlan[]} />
      </div>
    </Shell>
  )
}
