import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { Shell } from '@/components/studio/Shell'
import { CreateWizard } from '@/components/studio/CreateWizard'

export default async function CreatePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)
  const wallet = await getWallet(user.id)

  return (
    <Shell locale={locale} userName={user.name ?? user.email} credits={wallet.balance}>
      <div className="mx-auto w-full max-w-3xl">
        <CreateWizard locale={locale} />
      </div>
    </Shell>
  )
}
