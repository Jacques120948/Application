import { notFound, redirect } from 'next/navigation'
import { AppError } from '@/lib/errors'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEffectivePlan } from '@/server/billing/plans'
import { isAiAvailable } from '@/server/ai/client'
import { getIdea } from '@/server/business/ideas'
import { Shell } from '@/components/studio/Shell'
import { IdeaStudy } from '@/components/studio/IdeaStudy'

/** Étapes 4 et 5 du parcours : étudier une idée, puis lire son cahier des charges. */
export default async function IdeaStudyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale: rawLocale, id } = await params
  const locale = resolveLocale(rawLocale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  let idea
  try {
    idea = await getIdea(user.id, id)
  } catch (error) {
    if (error instanceof AppError) notFound()
    throw error
  }

  const [wallet, plan] = await Promise.all([getWallet(user.id), getEffectivePlan(user.id)])

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}>
      <div className="mx-auto w-full max-w-3xl">
        <IdeaStudy
          locale={locale}
          initialIdea={idea}
          canBuild={plan.allowBuild && plan.maxProjects > 0}
          aiAvailable={isAiAvailable()}
        />
      </div>
    </Shell>
  )
}
