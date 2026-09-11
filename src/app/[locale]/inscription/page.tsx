import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { env } from '@/lib/env'
import { getCurrentUser } from '@/server/auth/session'
import { Card, CardBody } from '@/components/ui'
import { Logo } from '@/components/marketing/Logo'
import { AuthForm } from '@/components/studio/AuthForm'

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  if ((await getCurrentUser()) !== null) redirect(`/${locale}/dashboard`)
  const t = getTranslator(locale)

  return (
    <div className="mx-auto w-full max-w-md px-5 py-16">
      <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
        <Logo id="mark-register" size={30} wordmark={t('common.appName')} />
      </a>
      <h1 className="mt-6 mb-6 text-2xl font-semibold">{t('auth.registerTitle')}</h1>
      <Card>
        <CardBody>
          <AuthForm
            mode="register"
            locale={locale}
            requiresCode={env.signupCode !== undefined}
            labels={{
              email: t('auth.email'),
              password: t('auth.password'),
              name: t('auth.name'),
              passwordHint: t('auth.passwordHint'),
              submit: t('nav.register'),
            }}
          />
        </CardBody>
      </Card>
      <p className="mt-5 text-center text-sm text-[var(--color-ink-soft)]">
        {t('auth.hasAccount')}{' '}
        <a href={`/${locale}/connexion`} className="text-[var(--color-brand)]">
          {t('nav.login')}
        </a>
      </p>
    </div>
  )
}
