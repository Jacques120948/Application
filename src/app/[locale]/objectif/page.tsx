import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getProfile } from '@/server/business/profile'
import { Shell } from '@/components/studio/Shell'
import { ObjectiveForm } from '@/components/studio/ObjectiveForm'

export default async function ObjectivePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const [profile, wallet] = await Promise.all([getProfile(user.id), getWallet(user.id)])

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}>
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="mb-1 text-2xl font-semibold">Par où commencer</h1>
        <p className="mb-7 text-[var(--color-ink-soft)]">
          Quelques questions, puis nous vous proposons des idées d&apos;applications
          réalistes pour vous. Vous n&apos;avez pas besoin d&apos;avoir une idée.
        </p>
        <ObjectiveForm locale={locale} profile={profile} />
      </div>
    </Shell>
  )
}
