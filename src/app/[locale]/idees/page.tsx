import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEffectivePlan } from '@/server/billing/plans'
import { isAiAvailable } from '@/server/ai/client'
import { getProfile } from '@/server/business/profile'
import { listIdeas } from '@/server/business/ideas'
import { formatAmount } from '@/server/business/economics'
import { Shell } from '@/components/studio/Shell'
import { IdeasBoard } from '@/components/studio/IdeasBoard'

export default async function IdeasPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const profile = await getProfile(user.id)
  // Le parcours part toujours de l'objectif : sans lui, rien à proposer.
  if (profile === null || profile.completedAt === null) redirect(`/${locale}/objectif`)

  const [ideas, wallet, plan] = await Promise.all([
    listIdeas(user.id),
    getWallet(user.id),
    getEffectivePlan(user.id),
  ])

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}>
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="mb-1 text-2xl font-semibold">Des idées pour vous</h1>
        <p className="mb-7 text-[var(--color-ink-soft)]">
          Chaque idée est chiffrée pour que vous puissiez comparer. Les nombres de clients
          sont des calculs, pas des prévisions.
        </p>
        <IdeasBoard
          locale={locale}
          initialIdeas={ideas}
          objectiveLabel={`${formatAmount(profile.monthlyGoalCents)} par mois`}
          canBuild={plan.allowBuild && plan.maxProjects > 0}
          aiAvailable={isAiAvailable()}
        />
      </div>
    </Shell>
  )
}
