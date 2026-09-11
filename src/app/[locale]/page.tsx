import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { Card, CardBody, LinkButton } from '@/components/ui'

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user !== null) redirect(`/${locale}/dashboard`)

  const t = getTranslator(locale)
  const steps = [
    { title: t('home.step1Title'), body: t('home.step1Body') },
    { title: t('home.step2Title'), body: t('home.step2Body') },
    { title: t('home.step3Title'), body: t('home.step3Body') },
  ]

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex w-full max-w-5xl items-center px-5 py-5">
        <span className="font-semibold">{t('common.appName')}</span>
        <div className="ml-auto flex items-center gap-3">
          <LinkButton href={`/${locale}/connexion`} variant="ghost">
            {t('nav.login')}
          </LinkButton>
          <LinkButton href={`/${locale}/inscription`}>{t('nav.register')}</LinkButton>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5">
        <section className="py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
            {t('home.heroTitle')}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-[var(--color-ink-soft)]">
            {t('home.heroBody')}
          </p>
          <LinkButton href={`/${locale}/inscription`} size="large" className="mt-9">
            {t('home.cta')}
          </LinkButton>
          <p className="mx-auto mt-6 max-w-xl text-sm text-[var(--color-ink-faint)]">
            {t('home.notAnotherBuilder')}
          </p>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          {steps.map((step, index) => (
            <Card key={step.title}>
              <CardBody>
                <span className="text-xs font-semibold text-[var(--color-brand)]">
                  Étape {index + 1}
                </span>
                <h2 className="mt-2 text-base font-semibold">{step.title}</h2>
                <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{step.body}</p>
              </CardBody>
            </Card>
          ))}
        </section>
      </main>
    </div>
  )
}
