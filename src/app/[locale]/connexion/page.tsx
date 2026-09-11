import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { Card, CardBody } from '@/components/ui'
import { AuthForm } from '@/components/studio/AuthForm'

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  if ((await getCurrentUser()) !== null) redirect(`/${locale}/dashboard`)
  const t = getTranslator(locale)

  return (
    <div className="mx-auto w-full max-w-md px-5 py-16">
      <h1 className="mb-6 text-2xl font-semibold">{t('auth.loginTitle')}</h1>
      <Card>
        <CardBody>
          <AuthForm
            mode="login"
            locale={locale}
            labels={{
              email: t('auth.email'),
              password: t('auth.password'),
              name: t('auth.name'),
              passwordHint: t('auth.passwordHint'),
              submit: t('nav.login'),
            }}
          />
        </CardBody>
      </Card>
      <p className="mt-5 text-center text-sm text-[var(--color-ink-soft)]">
        {t('auth.noAccount')}{' '}
        <a href={`/${locale}/inscription`} className="text-[var(--color-brand)]">
          {t('nav.register')}
        </a>
      </p>
    </div>
  )
}
